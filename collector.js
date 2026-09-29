"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * REAL DATA COLLECTION ENGINE
 * File: collector.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - استقبال روابط HTTP/HTTPS
 * - التحقق من الرابط
 * - منع الوصول إلى الشبكات الداخلية
 * - جلب البيانات
 * - تحديد نوع المحتوى
 * - تحديد حجم المحتوى
 * - تحليل المحتوى الأولي
 * - تحويل JSON / CSV / TXT / HTML إلى بيانات قابلة للمعالجة
 *
 * ملاحظات:
 * - يستخدم Node.js الحديثة و fetch المدمج.
 * - لا يحتاج API Key.
 * - لا يتجاوز تسجيل الدخول أو الحماية.
 * - لا يتعامل مع المصادر غير المسموح بها.
 * ============================================================
 */

const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

/* ============================================================
   إعدادات المحرك
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    USER_AGENT:
        "NOVA-DATA-AI-Collector/1.0 (+authorized-data-collection)",

    DEFAULT_TIMEOUT_MS: 15000,

    MAX_RESPONSE_BYTES:
        5 * 1024 * 1024,

    MAX_REDIRECTS: 0,

    ALLOWED_PROTOCOLS: [
        "http:",
        "https:"
    ],

    ALLOWED_TEXT_TYPES: [
        "text/plain",
        "text/html",
        "text/csv",
        "application/json",
        "application/xml",
        "text/xml",
        "application/javascript",
        "text/javascript",
        "application/ld+json"
    ],

    BLOCKED_HOSTNAMES: [
        "localhost",
        "localhost.localdomain",
        "metadata.google.internal",
        "instance-data"
    ]
});

/* ============================================================
   أدوات عامة
============================================================ */

function makeId(prefix = "collect") {
    return `${prefix}_${crypto.randomUUID()}`;
}

function currentTime() {
    return new Date().toISOString();
}

function cleanText(value, maxLength = 10000) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, maxLength);
}

function byteLength(text) {
    return Buffer.byteLength(
        String(text || ""),
        "utf8"
    );
}

function sleep(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

/* ============================================================
   أخطاء المحرك
============================================================ */

class CollectorError extends Error {
    constructor(
        message,
        code = "COLLECTOR_ERROR",
        details = {}
    ) {
        super(message);

        this.name = "CollectorError";
        this.code = code;
        this.details = details;
    }
}

/* ============================================================
   فحص IP
============================================================ */

function ipv4ToNumbers(ip) {
    const parts = ip.split(".");

    if (parts.length !== 4) {
        return null;
    }

    const numbers = parts.map(Number);

    if (
        numbers.some(
            number =>
                !Number.isInteger(number) ||
                number < 0 ||
                number > 255
        )
    ) {
        return null;
    }

    return numbers;
}

function isPrivateIPv4(ip) {
    const parts = ipv4ToNumbers(ip);

    if (!parts) {
        return false;
    }

    const [a, b] = parts;

    /*
     * 0.0.0.0/8
     */
    if (a === 0) {
        return true;
    }

    /*
     * 10.0.0.0/8
     */
    if (a === 10) {
        return true;
    }

    /*
     * 100.64.0.0/10
     * Carrier-grade NAT
     */
    if (
        a === 100 &&
        b >= 64 &&
        b <= 127
    ) {
        return true;
    }

    /*
     * 127.0.0.0/8
     */
    if (a === 127) {
        return true;
    }

    /*
     * 169.254.0.0/16
     */
    if (
        a === 169 &&
        b === 254
    ) {
        return true;
    }

    /*
     * 172.16.0.0/12
     */
    if (
        a === 172 &&
        b >= 16 &&
        b <= 31
    ) {
        return true;
    }

    /*
     * 192.0.0.0/24
     */
    if (
        a === 192 &&
        b === 0
    ) {
        return true;
    }

    /*
     * 192.0.2.0/24
     */
    if (
        a === 192 &&
        b === 0 &&
        parts[2] === 2
    ) {
        return true;
    }

    /*
     * 192.168.0.0/16
     */
    if (
        a === 192 &&
        b === 168
    ) {
        return true;
    }

    /*
     * 198.18.0.0/15
     */
    if (
        a === 198 &&
        (b === 18 || b === 19)
    ) {
        return true;
    }

    /*
     * 198.51.100.0/24
     */
    if (
        a === 198 &&
        b === 51 &&
        parts[2] === 100
    ) {
        return true;
    }

    /*
     * 203.0.113.0/24
     */
    if (
        a === 203 &&
        b === 0 &&
        parts[2] === 113
    ) {
        return true;
    }

    /*
     * 224.0.0.0/4 multicast
     */
    if (a >= 224 && a <= 239) {
        return true;
    }

    /*
     * 240.0.0.0/4 reserved
     */
    if (a >= 240) {
        return true;
    }

    return false;
}

function isPrivateIPv6(ip) {
    const normalized =
        String(ip || "")
            .toLowerCase()
            .replace(/^\[/, "")
            .replace(/\]$/, "");

    if (!normalized) {
        return false;
    }

    /*
     * IPv6 localhost
     */
    if (
        normalized === "::1"
    ) {
        return true;
    }

    /*
     * Unspecified address
     */
    if (
        normalized === "::"
    ) {
        return true;
    }

    /*
     * Link-local
     */
    if (
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
    ) {
        return true;
    }

    /*
     * Unique local addresses fc00::/7
     */
    if (
        normalized.startsWith("fc") ||
        normalized.startsWith("fd")
    ) {
        return true;
    }

    return false;
}

function isPrivateAddress(ip) {
    const version =
        net.isIP(ip);

    if (version === 4) {
        return isPrivateIPv4(ip);
    }

    if (version === 6) {
        return isPrivateIPv6(ip);
    }

    return false;
}

/* ============================================================
   فحص اسم النطاق
============================================================ */

function normalizeHostname(hostname) {
    return String(hostname || "")
        .toLowerCase()
        .replace(/\.$/, "");
}

function isBlockedHostname(hostname) {
    const host =
        normalizeHostname(hostname);

    if (!host) {
        return true;
    }

    if (
        CONFIG.BLOCKED_HOSTNAMES.includes(
            host
        )
    ) {
        return true;
    }

    /*
     * منع نطاقات localhost
     */
    if (
        host === "localhost" ||
        host.endsWith(".localhost")
    ) {
        return true;
    }

    /*
     * منع أسماء الشبكات المحلية
     */
    if (
        host.endsWith(".local") ||
        host.endsWith(".internal")
    ) {
        return true;
    }

    return false;
}

/* ============================================================
   تحليل الرابط
============================================================ */

function parseURL(input) {
    const value =
        cleanText(input, 4000);

    if (!value) {
        throw new CollectorError(
            "الرابط فارغ.",
            "EMPTY_URL"
        );
    }

    let url;

    try {
        url = new URL(value);
    } catch {
        throw new CollectorError(
            "الرابط غير صالح.",
            "INVALID_URL"
        );
    }

    if (
        !CONFIG.ALLOWED_PROTOCOLS.includes(
            url.protocol
        )
    ) {
        throw new CollectorError(
            "يسمح فقط بروابط HTTP و HTTPS.",
            "UNSUPPORTED_PROTOCOL"
        );
    }

    if (
        url.username ||
        url.password
    ) {
        throw new CollectorError(
            "لا يسمح بروابط تحتوي بيانات دخول.",
            "URL_CREDENTIALS_BLOCKED"
        );
    }

    if (
        isBlockedHostname(
            url.hostname
        )
    ) {
        throw new CollectorError(
            "هذا النطاق غير مسموح.",
            "BLOCKED_HOSTNAME"
        );
    }

    return url;
}

/* ============================================================
   التحقق من DNS
============================================================ */

async function resolveAndValidateHost(hostname) {
    const normalized =
        normalizeHostname(hostname);

    /*
     * إذا كان IP مباشرًا
     */
    if (net.isIP(normalized)) {
        if (
            isPrivateAddress(normalized)
        ) {
            throw new CollectorError(
                "عنوان الشبكة الداخلية غير مسموح.",
                "PRIVATE_ADDRESS"
            );
        }

        return {
            hostname: normalized,
            addresses: [
                normalized
            ]
        };
    }

    let records;

    try {
        records =
            await dns.lookup(
                normalized,
                {
                    all: true,
                    verbatim: true
                }
            );
    } catch (error) {
        throw new CollectorError(
            "تعذر العثور على عنوان المصدر.",
            "DNS_LOOKUP_FAILED",
            {
                hostname: normalized
            }
        );
    }

    if (
        !Array.isArray(records) ||
        records.length === 0
    ) {
        throw new CollectorError(
            "المصدر لا يملك عنوانًا قابلاً للوصول.",
            "NO_DNS_RESULT"
        );
    }

    const addresses =
        records.map(
            item => item.address
        );

    for (
        const address of addresses
    ) {
        if (
            isPrivateAddress(address)
        ) {
            throw new CollectorError(
                "المصدر يشير إلى شبكة داخلية غير مسموحة.",
                "PRIVATE_ADDRESS"
            );
        }
    }

    return {
        hostname: normalized,
        addresses
    };
}

/* ============================================================
   فحص حجم الاستجابة
============================================================ */

function contentLengthFromHeaders(
    headers
) {
    const value =
        headers.get(
            "content-length"
        );

    if (!value) {
        return null;
    }

    const length =
        Number(value);

    if (
        !Number.isFinite(length) ||
        length < 0
    ) {
        return null;
    }

    return length;
}

/* ============================================================
   فحص نوع المحتوى
============================================================ */

function normalizeContentType(
    contentType
) {
    return String(
        contentType || ""
    )
        .split(";")[0]
        .trim()
        .toLowerCase();
}

function isSupportedContentType(
    contentType
) {
    const normalized =
        normalizeContentType(
            contentType
        );

    if (
        CONFIG.ALLOWED_TEXT_TYPES.includes(
            normalized
        )
    ) {
        return true;
    }

    /*
     * بعض الخوادم ترسل أنواعًا عامة
     */
    if (
        normalized.startsWith(
            "text/"
        )
    ) {
        return true;
    }

    return false;
}

function detectFormat(
    contentType,
    text,
    url
) {
    const type =
        normalizeContentType(
            contentType
        );

    const clean =
        String(text || "")
            .trim();

    const pathname =
        String(
            url?.pathname || ""
        ).toLowerCase();

    if (
        type.includes("json") ||
        clean.startsWith("{") ||
        clean.startsWith("[") ||
        pathname.endsWith(".json")
    ) {
        return "json";
    }

    if (
        type.includes("csv") ||
        pathname.endsWith(".csv")
    ) {
        return "csv";
    }

    if (
        type.includes("html") ||
        pathname.endsWith(".html") ||
        pathname.endsWith(".htm")
    ) {
        return "html";
    }

    if (
        type.includes("xml") ||
        pathname.endsWith(".xml")
    ) {
        return "xml";
    }

    if (
        type.startsWith("text/")
    ) {
        return "text";
    }

    return "unknown";
}

/* ============================================================
   قراءة الاستجابة مع حد للحجم
============================================================ */

async function readResponseText(
    response,
    maxBytes
) {
    const reader =
        response.body?.getReader?.();

    /*
     * fallback
     */
    if (!reader) {
        const text =
            await response.text();

        if (
            byteLength(text) >
            maxBytes
        ) {
            throw new CollectorError(
                "المحتوى أكبر من الحد المسموح.",
                "RESPONSE_TOO_LARGE"
            );
        }

        return text;
    }

    const chunks = [];
    let total = 0;

    while (true) {
        const { value, done } =
            await reader.read();

        if (done) {
            break;
        }

        if (!value) {
            continue;
        }

        total += value.byteLength;

        if (total > maxBytes) {
            try {
                await reader.cancel();
            } catch {
                /* تجاهل */
            }

            throw new CollectorError(
                "المحتوى أكبر من الحد المسموح.",
                "RESPONSE_TOO_LARGE",
                {
                    maxBytes
                }
            );
        }

        chunks.push(
            Buffer.from(value)
        );
    }

    return Buffer.concat(
        chunks
    ).toString("utf8");
}

/* ============================================================
   تحويل CSV إلى صفوف
============================================================ */

function parseCSVLine(line) {
    const values = [];

    let current = "";
    let inQuotes = false;

    for (
        let i = 0;
        i < line.length;
        i++
    ) {
        const char =
            line[i];

        if (char === '"') {
            if (
                inQuotes &&
                line[i + 1] === '"'
            ) {
                current += '"';
                i++;
                continue;
            }

            inQuotes =
                !inQuotes;

            continue;
        }

        if (
            char === "," &&
            !inQuotes
        ) {
            values.push(
                current.trim()
            );

            current = "";

            continue;
        }

        current += char;
    }

    values.push(
        current.trim()
    );

    return values;
}

function parseCSV(text) {
    const lines =
        String(text || "")
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .split("\n")
            .filter(
                line =>
                    line.trim() !== ""
            );

    if (lines.length === 0) {
        return [];
    }

    const headers =
        parseCSVLine(
            lines[0]
        ).map(
            (header, index) =>
                cleanText(
                    header,
                    300
                ) ||
                `column_${index + 1}`
        );

    const rows = [];

    for (
        let lineIndex = 1;
        lineIndex < lines.length;
        lineIndex++
    ) {
        const values =
            parseCSVLine(
                lines[lineIndex]
            );

        const record = {};

        for (
            let columnIndex = 0;
            columnIndex < headers.length;
            columnIndex++
        ) {
            record[
                headers[columnIndex]
            ] =
                values[columnIndex] ??
                "";
        }

        rows.push(record);
    }

    return rows;
}

/* ============================================================
   تحويل JSON
============================================================ */

function parseJSON(text) {
    let data;

    try {
        data =
            JSON.parse(
                String(text || "")
            );
    } catch {
        throw new CollectorError(
            "بيانات JSON غير صالحة.",
            "INVALID_JSON"
        );
    }

    if (Array.isArray(data)) {
        return data;
    }

    if (
        data !== null &&
        typeof data === "object"
    ) {
        return [data];
    }

    return [
        {
            value: data
        }
    ];
}

/* ============================================================
   تحويل النص
============================================================ */

function parseText(text) {
    return String(
        text || ""
    )
        .split(/\n+/)
        .map(
            line =>
                line.trim()
        )
        .filter(Boolean)
        .map(
            line => ({
                text: line
            })
        );
}

/* ============================================================
   استخراج HTML بشكل أولي
============================================================ */

function decodeBasicHTML(
    text
) {
    return String(text || "")
        .replace(
            /&nbsp;/gi,
            " "
        )
        .replace(
            /&amp;/gi,
            "&"
        )
        .replace(
            /&lt;/gi,
            "<"
        )
        .replace(
            /&gt;/gi,
            ">"
        )
        .replace(
            /&quot;/gi,
            '"'
        )
        .replace(
            /&#39;/gi,
            "'"
        );
}

function stripHTML(text) {
    return decodeBasicHTML(
        String(text || "")
            .replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/gi,
                " "
            )
            .replace(
                /<style\b[^>]*>[\s\S]*?<\/style>/gi,
                " "
            )
            .replace(
                /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi,
                " "
            )
            .replace(
                /<svg\b[^>]*>[\s\S]*?<\/svg>/gi,
                " "
            )
            .replace(
                /<[^>]+>/g,
                " "
            )
            .replace(
                /\s+/g,
                " "
            )
            .trim()
    );
}

function extractHTML(text) {
    const source =
        String(text || "");

    const titleMatch =
        source.match(
            /<title\b[^>]*>([\s\S]*?)<\/title>/i
        );

    const title =
        titleMatch
            ? stripHTML(
                  titleMatch[1]
              )
            : "";

    const clean =
        stripHTML(source);

    if (!clean) {
        return [];
    }

    return [
        {
            title,
            text: clean
        }
    ];
}

/* ============================================================
   تحليل XML
============================================================ */

function extractXML(text) {
    const clean =
        stripHTML(
            String(text || "")
        );

    if (!clean) {
        return [];
    }

    return [
        {
            text: clean
        }
    ];
}

/* ============================================================
   تحليل المصدر
============================================================ */

function parseCollectedContent({
    text,
    contentType,
    url
}) {
    const format =
        detectFormat(
            contentType,
            text,
            url
        );

    let records = [];

    switch (format) {
        case "json":
            records =
                parseJSON(text);
            break;

        case "csv":
            records =
                parseCSV(text);
            break;

        case "html":
            records =
                extractHTML(text);
            break;

        case "xml":
            records =
                extractXML(text);
            break;

        case "text":
            records =
                parseText(text);
            break;

        default:
            records = [];
            break;
    }

    return {
        format,
        records
    };
}

/* ============================================================
   فحص headers
============================================================ */

function headerValue(
    response,
    name
) {
    return response.headers.get(
        name
    ) || "";
}

function collectHeaders(
    response
) {
    return {
        contentType:
            headerValue(
                response,
                "content-type"
            ),
        contentLength:
            headerValue(
                response,
                "content-length"
            ),
        etag:
            headerValue(
                response,
                "etag"
            ),
        lastModified:
            headerValue(
                response,
                "last-modified"
            ),
        cacheControl:
            headerValue(
                response,
                "cache-control"
            )
    };
}

/* ============================================================
   إنشاء تقرير التجميع
============================================================ */

function createCollectionReport({
    sourceURL,
    format,
    response,
    text,
    records,
    startedAt
}) {
    const finishedAt =
        currentTime();

    const bytes =
        byteLength(text);

    return {
        id: makeId("collection"),
        source: {
            url: sourceURL.toString(),
            hostname:
                sourceURL.hostname
        },

        format,

        response: {
            status:
                response.status,
            statusText:
                response.statusText,
            headers:
                collectHeaders(
                    response
                )
        },

        content: {
            bytes,
            characters:
                text.length
        },

        records: {
            count:
                records.length
        },

        startedAt,
        finishedAt,

        success: true
    };
}

/* ============================================================
   جامع البيانات الرئيسي
============================================================ */

async function collectFromURL(
    input,
    options = {}
) {
    const startedAt =
        currentTime();

    const url =
        parseURL(input);

    const timeout =
        Number.isFinite(
            Number(
                options.timeout
            )
        )
            ? Math.max(
                  1000,
                  Number(
                      options.timeout
                  )
              )
            : CONFIG.DEFAULT_TIMEOUT_MS;

    const maxBytes =
        Number.isFinite(
            Number(
                options.maxBytes
            )
        )
            ? Math.min(
                  CONFIG.MAX_RESPONSE_BYTES,
                  Math.max(
                      1024,
                      Number(
                          options.maxBytes
                      )
                  )
              )
            : CONFIG.MAX_RESPONSE_BYTES;

    /*
     * حماية DNS / الشبكات الداخلية
     */
    await resolveAndValidateHost(
        url.hostname
    );

    const controller =
        new AbortController();

    const timer =
        setTimeout(
            () =>
                controller.abort(),
            timeout
        );

    let response;

    try {
        response =
            await fetch(
                url.toString(),
                {
                    method: "GET",
                    redirect: "error",
                    signal:
                        controller.signal,

                    headers: {
                        "User-Agent":
                            CONFIG.USER_AGENT,

                        "Accept":
                            "application/json,text/csv,text/plain,text/html,application/xml;q=0.9,*/*;q=0.1",

                        "Accept-Language":
                            "ar,en;q=0.8"
                    }
                }
            );
    } catch (error) {
        if (
            error?.name ===
            "AbortError"
        ) {
            throw new CollectorError(
                "انتهت مهلة الاتصال بالمصدر.",
                "REQUEST_TIMEOUT"
            );
        }

        throw new CollectorError(
            "تعذر الاتصال بالمصدر.",
            "FETCH_FAILED",
            {
                message:
                    error?.message || ""
            }
        );
    } finally {
        clearTimeout(
            timer
        );
    }

    /*
     * التحقق من HTTP
     */
    if (!response.ok) {
        throw new CollectorError(
            `المصدر أعاد HTTP ${response.status}.`,
            "HTTP_ERROR",
            {
                status:
                    response.status
            }
        );
    }

    /*
     * Content-Length
     */
    const declaredLength =
        contentLengthFromHeaders(
            response.headers
        );

    if (
        declaredLength !== null &&
        declaredLength > maxBytes
    ) {
        throw new CollectorError(
            "حجم المصدر أكبر من الحد المسموح.",
            "RESPONSE_TOO_LARGE",
            {
                declaredLength,
                maxBytes
            }
        );
    }

    const contentType =
        normalizeContentType(
            headerValue(
                response,
                "content-type"
            )
        );

    /*
     * السماح فقط بالمحتوى النصي المعروف
     */
    if (
        !isSupportedContentType(
            contentType
        )
    ) {
        throw new CollectorError(
            `نوع المحتوى غير مدعوم: ${contentType || "unknown"}`,
            "UNSUPPORTED_CONTENT_TYPE",
            {
                contentType
            }
        );
    }

    const text =
        await readResponseText(
            response,
            maxBytes
        );

    /*
     * تحليل المحتوى
     */
    const parsed =
        parseCollectedContent({
            text,
            contentType,
            url
        });

    /*
     * التقرير
     */
    const report =
        createCollectionReport({
            sourceURL: url,
            format:
                parsed.format,
            response,
            text,
            records:
                parsed.records,
            startedAt
        });

    return {
        success: true,

        collection: {
            id:
                report.id,

            source: {
                url:
                    url.toString(),

                protocol:
                    url.protocol,

                hostname:
                    url.hostname,

                pathname:
                    url.pathname
            },

            content: {
                type:
                    contentType,

                format:
                    parsed.format,

                bytes:
                    byteLength(
                        text
                    ),

                characters:
                    text.length
            },

            records:
                parsed.records,

            recordCount:
                parsed.records.length,

            report
        }
    };
}

/* ============================================================
   جامع النص المباشر
============================================================ */

function collectFromText(
    text,
    options = {}
) {
    const startedAt =
        currentTime();

    const value =
        cleanText(
            text,
            options.maxCharacters ||
                1000000
        );

    if (!value) {
        throw new CollectorError(
            "النص فارغ.",
            "EMPTY_DATA"
        );
    }

    const fakeURL =
        new URL(
            "https://local.nova-data-ai.invalid/source.txt"
        );

    const parsed =
        parseCollectedContent({
            text: value,
            contentType:
                options.contentType ||
                "text/plain",
            url:
                fakeURL
        });

    return {
        success: true,

        collection: {
            id:
                makeId("collection"),

            source: {
                type:
                    "text"
            },

            content: {
                type:
                    options.contentType ||
                    "text/plain",

                format:
                    parsed.format,

                bytes:
                    byteLength(value),

                characters:
                    value.length
            },

            records:
                parsed.records,

            recordCount:
                parsed.records.length,

            startedAt,

            finishedAt:
                currentTime()
        }
    };
}

/* ============================================================
   جامع JSON المباشر
============================================================ */

function collectFromJSON(
    input
) {
    const startedAt =
        currentTime();

    let data;

    if (
        typeof input === "string"
    ) {
        data =
            parseJSON(input);
    } else if (
        Array.isArray(input)
    ) {
        data = input;
    } else if (
        input !== null &&
        typeof input === "object"
    ) {
        data = [input];
    } else {
        data = [
            {
                value: input
            }
        ];
    }

    return {
        success: true,

        collection: {
            id:
                makeId("collection"),

            source: {
                type:
                    "json"
            },

            content: {
                type:
                    "application/json",

                format:
                    "json",

                records:
                    data.length
            },

            records:
                data,

            recordCount:
                data.length,

            startedAt,

            finishedAt:
                currentTime()
        }
    };
}

/* ============================================================
   جامع CSV المباشر
============================================================ */

function collectFromCSV(
    text
) {
    const startedAt =
        currentTime();

    const records =
        parseCSV(text);

    return {
        success: true,

        collection: {
            id:
                makeId("collection"),

            source: {
                type:
                    "csv"
            },

            content: {
                type:
                    "text/csv",

                format:
                    "csv",

                records:
                    records.length
            },

            records,

            recordCount:
                records.length,

            startedAt,

            finishedAt:
                currentTime()
        }
    };
}

/* ============================================================
   فحص مجموعة مصادر
============================================================ */

async function collectMany(
    sources,
    options = {}
) {
    if (
        !Array.isArray(sources)
    ) {
        throw new CollectorError(
            "sources يجب أن تكون مصفوفة.",
            "INVALID_SOURCES"
        );
    }

    const results = [];

    for (
        const source of sources
    ) {
        if (
            typeof source ===
            "string"
        ) {
            try {
                const result =
                    await collectFromURL(
                        source,
                        options
                    );

                results.push({
                    source,
                    success: true,
                    result
                });
            } catch (error) {
                results.push({
                    source,
                    success: false,
                    error: serializeError(
                        error
                    )
                });
            }

            continue;
        }

        if (
            source &&
            typeof source ===
                "object"
        ) {
            const sourceURL =
                source.url;

            if (!sourceURL) {
                results.push({
                    source,
                    success: false,
                    error: {
                        code:
                            "MISSING_URL",
                        message:
                            "الرابط مفقود."
                    }
                });

                continue;
            }

            try {
                const result =
                    await collectFromURL(
                        sourceURL,
                        {
                            ...options,
                            ...(source.options ||
                                {})
                        }
                    );

                results.push({
                    source,
                    success: true,
                    result
                });
            } catch (error) {
                results.push({
                    source,
                    success: false,
                    error: serializeError(
                        error
                    )
                });
            }

            continue;
        }

        results.push({
            source,
            success: false,
            error: {
                code:
                    "INVALID_SOURCE",
                message:
                    "المصدر غير صالح."
            }
        });
    }

    const successful =
        results.filter(
            item =>
                item.success
        );

    const failed =
        results.filter(
            item =>
                !item.success
        );

    const totalRecords =
        successful.reduce(
            (
                total,
                item
            ) =>
                total +
                Number(
                    item.result
                        ?.recordCount || 0
                ),
            0
        );

    return {
        success:
            failed.length === 0,

        summary: {
            totalSources:
                results.length,

            successfulSources:
                successful.length,

            failedSources:
                failed.length,

            totalRecords
        },

        results
    };
}

/* ============================================================
   دمج نتائج عدة مصادر
============================================================ */

function mergeCollections(
    collectionResults
) {
    const allRecords = [];

    if (
        !Array.isArray(
            collectionResults
        )
    ) {
        return {
            records: [],
            recordCount: 0
        };
    }

    for (
        const item of
            collectionResults
    ) {
        if (
            !item ||
            !item.success
        ) {
            continue;
        }

        const records =
            item.result
                ?.collection
                ?.records;

        if (
            Array.isArray(
                records
            )
        ) {
            allRecords.push(
                ...records
            );
        }
    }

    return {
        records:
            allRecords,

        recordCount:
            allRecords.length
    };
}

/* ============================================================
   إزالة التكرار في نتائج التجميع
============================================================ */

function stableSerialize(
    value
) {
    if (
        value === null ||
        typeof value !==
            "object"
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(",")}]`;
    }

    const keys =
        Object.keys(value)
            .sort();

    return `{${keys
        .map(
            key =>
                `${JSON.stringify(
                    key
                )}:${stableSerialize(
                    value[key]
                )}`
        )
        .join(",")}}`;
}

function deduplicateRecords(
    records
) {
    if (
        !Array.isArray(records)
    ) {
        return [];
    }

    const seen =
        new Set();

    const output = [];

    for (
        const record of
            records
    ) {
        const key =
            stableSerialize(
                record
            );

        if (
            seen.has(key)
        ) {
            continue;
        }

        seen.add(key);

        output.push(
            record
        );
    }

    return output;
}

/* ============================================================
   جمع + دمج + إزالة تكرار
============================================================ */

async function collectAndMerge(
    sources,
    options = {}
) {
    const collected =
        await collectMany(
            sources,
            options
        );

    const merged =
        mergeCollections(
            collected.results
        );

    const unique =
        deduplicateRecords(
            merged.records
        );

    return {
        success:
            collected.success,

        summary: {
            ...collected.summary,

            recordsBeforeDeduplication:
                merged.recordCount,

            uniqueRecords:
                unique.length,

            duplicatesRemoved:
                merged.recordCount -
                unique.length
        },

        records:
            unique,

        sources:
            collected.results
    };
}

/* ============================================================
   إنشاء Dataset مبدئي من نتيجة التجميع
============================================================ */

function createDatasetDraft({
    name,
    type = "general",
    records = [],
    sources = []
}) {
    const safeName =
        cleanText(
            name,
            150
        ) ||
        `NOVA Dataset ${new Date().toLocaleDateString(
            "ar"
        )}`;

    const safeRecords =
        Array.isArray(
            records
        )
            ? records
            : [];

    return {
        id:
            makeId("dataset"),

        name:
            safeName,

        type:
            cleanText(
                type,
                50
            ) ||
            "general",

        source: {
            type:
                "collector",

            count:
                Array.isArray(
                    sources
                )
                    ? sources.length
                    : 0
        },

        records:
            safeRecords,

        recordCount:
            safeRecords.length,

        status:
            "collected",

        createdAt:
            currentTime(),

        updatedAt:
            currentTime(),

        collection: {
            engine:
                "NOVA DATA AI Collector",

            version:
                CONFIG.VERSION,

            sources:
                Array.isArray(
                    sources
                )
                    ? sources
                    : []
        }
    };
}

/* ============================================================
   تنظيف نتيجة الخطأ
============================================================ */

function serializeError(
    error
) {
    if (
        error instanceof
        CollectorError
    ) {
        return {
            name:
                error.name,

            code:
                error.code,

            message:
                error.message,

            details:
                error.details
        };
    }

    return {
        name:
            error?.name ||
            "Error",

        code:
            "UNKNOWN_ERROR",

        message:
            error?.message ||
            "حدث خطأ غير معروف."
    };
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Collector",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        capabilities: [
            "HTTP",
            "HTTPS",
            "JSON",
            "CSV",
            "TXT",
            "HTML",
            "XML",
            "DNS validation",
            "Private network protection",
            "Response size limits",
            "Request timeout",
            "Multi-source collection",
            "Collection reports",
            "Record merging",
            "Record deduplication"
        ],

        limits: {
            maxResponseBytes:
                CONFIG.MAX_RESPONSE_BYTES,

            timeoutMs:
                CONFIG.DEFAULT_TIMEOUT_MS,

            maxRedirects:
                CONFIG.MAX_REDIRECTS
        }
    };
}

/* ============================================================
   API المحرك
============================================================ */

const collector = Object.freeze({
    version:
        CONFIG.VERSION,

    config:
        CONFIG,

    CollectorError,

    parseURL,

    collectFromURL,

    collectFromText,

    collectFromJSON,

    collectFromCSV,

    collectMany,

    mergeCollections,

    deduplicateRecords,

    collectAndMerge,

    createDatasetDraft,

    getEngineInfo,

    parseCollectedContent,

    parseCSV,

    parseJSON,

    parseText,

    extractHTML,

    extractXML,

    serializeError,

    sleep
});

/* ============================================================
   تصدير
============================================================ */

module.exports =
    collector;

/* ============================================================
   تشغيل مباشر لاختبار المحرك
============================================================ */

if (
    require.main === module
) {
    console.log("");
    console.log(
        "=============================================="
    );
    console.log(
        "     NOVA DATA AI - COLLECTOR ENGINE"
    );
    console.log(
        "=============================================="
    );
    console.log(
        `Version: ${CONFIG.VERSION}`
    );
    console.log(
        "Status: READY"
    );
    console.log(
        `Max Response: ${CONFIG.MAX_RESPONSE_BYTES} bytes`
    );
    console.log(
        `Timeout: ${CONFIG.DEFAULT_TIMEOUT_MS} ms`
    );
    console.log(
        "Supported:"
    );
    console.log(
        "HTTP / HTTPS / JSON / CSV / TXT / HTML / XML"
    );
    console.log(
        "=============================================="
    );
    console.log("");
}
