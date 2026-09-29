const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "nova-data.json");
const INDEX_FILE = path.join(ROOT, "index.html");

const MAX_BODY_SIZE = "10mb";
const MAX_URL_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT = 15000;

app.disable("x-powered-by");

app.use(express.json({ limit: MAX_BODY_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_BODY_SIZE }));

app.use((req, res, next) => {
    const requestId = crypto.randomUUID();

    req.requestId = requestId;

    res.setHeader("X-Request-ID", requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()"
    );

    const start = Date.now();

    res.on("finish", () => {
        const duration = Date.now() - start;

        console.log(
            `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
        );
    });

    next();
});

function ensureStorage() {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = {
            version: 1,
            platform: {
                name: "NOVA DATA AI",
                createdAt: new Date().toISOString()
            },
            datasets: [],
            projects: [],
            collections: [],
            operations: [],
            settings: {
                platformName: "NOVA DATA AI",
                validationLevel: "standard"
            }
        };

        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(initial, null, 2),
            "utf8"
        );
    }
}

function readDB() {
    ensureStorage();

    try {
        const raw = fs.readFileSync(DATA_FILE, "utf8");

        if (!raw.trim()) {
            throw new Error("Database file is empty.");
        }

        return JSON.parse(raw);
    } catch (error) {
        console.error("Database read error:", error);

        return {
            version: 1,
            platform: {
                name: "NOVA DATA AI"
            },
            datasets: [],
            projects: [],
            collections: [],
            operations: [],
            settings: {
                platformName: "NOVA DATA AI",
                validationLevel: "standard"
            }
        };
    }
}

function writeDB(db) {
    const tempFile = `${DATA_FILE}.tmp`;

    fs.writeFileSync(
        tempFile,
        JSON.stringify(db, null, 2),
        "utf8"
    );

    fs.renameSync(tempFile, DATA_FILE);
}

function now() {
    return new Date().toISOString();
}

function id(prefix = "id") {
    return `${prefix}_${crypto.randomUUID()}`;
}

function cleanText(value, max = 10000) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, max);
}

function normalizeDatasetName(name) {
    const cleaned = cleanText(name, 150);

    return cleaned || `Dataset ${new Date().toLocaleDateString("ar")}`;
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return fallback;
    }

    return number;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function calculateCompleteness(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return 0;
    }

    let totalFields = 0;
    let filledFields = 0;

    for (const record of records) {
        if (record && typeof record === "object" && !Array.isArray(record)) {
            const keys = Object.keys(record);

            for (const key of keys) {
                totalFields++;

                const value = record[key];

                if (
                    value !== null &&
                    value !== undefined &&
                    String(value).trim() !== ""
                ) {
                    filledFields++;
                }
            }
        } else {
            totalFields++;
            filledFields++;
        }
    }

    if (totalFields === 0) {
        return 0;
    }

    return Math.round((filledFields / totalFields) * 100);
}

function stableStringify(value) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }

    const keys = Object.keys(value).sort();

    return `{${keys
        .map(
            key =>
                `${JSON.stringify(key)}:${stableStringify(value[key])}`
        )
        .join(",")}}`;
}

function calculateUniqueness(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return 0;
    }

    const seen = new Set();

    for (const record of records) {
        seen.add(stableStringify(record));
    }

    return Math.round((seen.size / records.length) * 100);
}

function calculateFormatScore(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return 0;
    }

    let valid = 0;

    for (const record of records) {
        if (
            record !== null &&
            (
                typeof record === "object" ||
                typeof record === "string" ||
                typeof record === "number" ||
                typeof record === "boolean"
            )
        ) {
            valid++;
        }
    }

    return Math.round((valid / records.length) * 100);
}

function calculateValidity(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return 0;
    }

    let valid = 0;

    for (const record of records) {
        if (record === null || record === undefined) {
            continue;
        }

        if (typeof record === "object") {
            const values = Object.values(record);

            if (
                values.length > 0 &&
                values.some(
                    value =>
                        value !== null &&
                        value !== undefined &&
                        String(value).trim() !== ""
                )
            ) {
                valid++;
            }
        } else if (String(record).trim() !== "") {
            valid++;
        }
    }

    return Math.round((valid / records.length) * 100);
}

function analyzeRecords(records) {
    const safeRecords = Array.isArray(records) ? records : [];

    const duplicates =
        safeRecords.length -
        new Set(safeRecords.map(stableStringify)).size;

    const completeness = calculateCompleteness(safeRecords);
    const uniqueness = calculateUniqueness(safeRecords);
    const format = calculateFormatScore(safeRecords);
    const validity = calculateValidity(safeRecords);

    const quality = Math.round(
        completeness * 0.25 +
        uniqueness * 0.25 +
        format * 0.25 +
        validity * 0.25
    );

    return {
        records: safeRecords.length,
        duplicates,
        completeness,
        uniqueness,
        format,
        validity,
        quality
    };
}

function detectSensitiveData(records) {
    const findings = [];

    const patterns = [
        {
            type: "email",
            regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
        },
        {
            type: "phone",
            regex: /(?:\+?\d[\d\s().-]{7,}\d)/
        },
        {
            type: "api_key",
            regex: /\b(?:sk|pk|api|key)[-_]?[A-Za-z0-9_-]{12,}\b/i
        },
        {
            type: "password",
            regex: /\b(?:password|passwd|pwd)\s*[:=]\s*[^\s]+/i
        },
        {
            type: "token",
            regex: /\b(?:token|secret)\s*[:=]\s*[^\s]+/i
        }
    ];

    for (let index = 0; index < records.length; index++) {
        const serialized = JSON.stringify(records[index]);

        for (const pattern of patterns) {
            if (pattern.regex.test(serialized)) {
                findings.push({
                    record: index + 1,
                    type: pattern.type
                });
            }
        }
    }

    return findings;
}

function removeDuplicates(records) {
    const seen = new Set();
    const output = [];

    for (const record of records) {
        const key = stableStringify(record);

        if (!seen.has(key)) {
            seen.add(key);
            output.push(record);
        }
    }

    return output;
}

function removeEmptyRecords(records) {
    return records.filter(record => {
        if (record === null || record === undefined) {
            return false;
        }

        if (typeof record === "string") {
            return record.trim() !== "";
        }

        if (typeof record === "object") {
            return Object.values(record).some(
                value =>
                    value !== null &&
                    value !== undefined &&
                    String(value).trim() !== ""
            );
        }

        return true;
    });
}

function normalizeRecord(record) {
    if (typeof record === "string") {
        return {
            text: record.trim()
        };
    }

    if (
        record !== null &&
        typeof record === "object" &&
        !Array.isArray(record)
    ) {
        const output = {};

        for (const [key, value] of Object.entries(record)) {
            const normalizedKey = cleanText(key, 200)
                .replace(/\s+/g, "_")
                .toLowerCase();

            output[normalizedKey] =
                typeof value === "string"
                    ? value.trim()
                    : value;
        }

        return output;
    }

    return {
        value: record
    };
}

function normalizeRecords(records) {
    return records.map(normalizeRecord);
}

function parseCSV(text) {
    const lines = text
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n")
        .filter(line => line.trim() !== "");

    if (lines.length === 0) {
        return [];
    }

    const parseLine = line => {
        const values = [];
        let current = "";
        let insideQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (
                    insideQuotes &&
                    line[i + 1] === '"'
                ) {
                    current += '"';
                    i++;
                } else {
                    insideQuotes = !insideQuotes;
                }
            } else if (char === "," && !insideQuotes) {
                values.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }

        values.push(current.trim());

        return values;
    };

    const headers = parseLine(lines[0]);

    return lines.slice(1).map(line => {
        const values = parseLine(line);
        const record = {};

        headers.forEach((header, index) => {
            record[header || `column_${index + 1}`] =
                values[index] ?? "";
        });

        return record;
    });
}

function parseTextData(text, type = "auto") {
    const clean = String(text || "").trim();

    if (!clean) {
        return [];
    }

    const lowerType = String(type).toLowerCase();

    if (
        lowerType === "json" ||
        lowerType === "application/json" ||
        clean.startsWith("{") ||
        clean.startsWith("[")
    ) {
        try {
            const parsed = JSON.parse(clean);

            if (Array.isArray(parsed)) {
                return parsed;
            }

            return [parsed];
        } catch {
            if (lowerType === "json") {
                throw new Error("JSON غير صالح.");
            }
        }
    }

    if (
        lowerType === "csv" ||
        lowerType === "text/csv"
    ) {
        return parseCSV(clean);
    }

    return clean
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => ({
            text: line
        }));
}

function createDataset({
    name,
    type,
    records,
    source,
    metadata = {}
}) {
    const normalized = normalizeRecords(records);
    const analysis = analyzeRecords(normalized);
    const sensitive = detectSensitiveData(normalized);

    return {
        id: id("dataset"),
        name: normalizeDatasetName(name),
        type: cleanText(type, 50) || "general",
        source: source || {
            type: "manual"
        },
        records: normalized,
        recordCount: normalized.length,
        status: "collected",
        createdAt: now(),
        updatedAt: now(),
        quality: {
            ...analysis,
            sensitiveFindings: sensitive.length
        },
        metadata: {
            ...metadata
        },
        history: [
            {
                action: "created",
                at: now()
            }
        ]
    };
}

function addOperation(db, operation) {
    db.operations.unshift({
        id: id("operation"),
        at: now(),
        ...operation
    });

    if (db.operations.length > 500) {
        db.operations = db.operations.slice(0, 500);
    }
}

function findDataset(db, datasetId) {
    return db.datasets.find(
        dataset => dataset.id === datasetId
    );
}

function isPrivateIPv4(ip) {
    const parts = ip.split(".").map(Number);

    if (parts.length !== 4 || parts.some(Number.isNaN)) {
        return false;
    }

    const [a, b] = parts;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;

    return false;
}

function isPrivateIPv6(ip) {
    const normalized = ip.toLowerCase();

    if (normalized === "::1") {
        return true;
    }

    if (
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe80:")
    ) {
        return true;
    }

    return false;
}

function isBlockedHostname(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, "");

    const blocked = [
        "localhost",
        "localhost.localdomain",
        "metadata.google.internal",
        "instance-data"
    ];

    if (blocked.includes(host)) {
        return true;
    }

    if (host.endsWith(".localhost")) {
        return true;
    }

    if (host.endsWith(".local")) {
        return true;
    }

    return false;
}

async function validateRemoteURL(input) {
    let url;

    try {
        url = new URL(input);
    } catch {
        throw new Error("الرابط غير صالح.");
    }

    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(
            "يسمح فقط بروابط HTTP و HTTPS."
        );
    }

    if (url.username || url.password) {
        throw new Error(
            "لا يسمح بروابط تحتوي بيانات دخول."
        );
    }

    if (isBlockedHostname(url.hostname)) {
        throw new Error(
            "هذا النطاق غير مسموح لأسباب أمنية."
        );
    }

    if (net.isIP(url.hostname)) {
        if (
            isPrivateIPv4(url.hostname) ||
            isPrivateIPv6(url.hostname)
        ) {
            throw new Error(
                "عناوين الشبكات الداخلية غير مسموحة."
            );
        }

        return url;
    }

    let addresses;

    try {
        addresses = await dns.lookup(
            url.hostname,
            {
                all: true,
                verbatim: true
            }
        );
    } catch {
        throw new Error(
            "تعذر التحقق من عنوان الموقع."
        );
    }

    if (!addresses.length) {
        throw new Error(
            "تعذر العثور على عنوان الموقع."
        );
    }

    for (const address of addresses) {
        if (
            isPrivateIPv4(address.address) ||
            isPrivateIPv6(address.address)
        ) {
            throw new Error(
                "الموقع يشير إلى شبكة داخلية غير مسموحة."
            );
        }
    }

    return url;
}

async function fetchRemoteData(url) {
    const validatedURL = await validateRemoteURL(url);

    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT
    );

    try {
        const response = await fetch(
            validatedURL.toString(),
            {
                method: "GET",
                redirect: "error",
                signal: controller.signal,
                headers: {
                    "User-Agent":
                        "NOVA-DATA-AI/1.0 (+authorized-data-collection)"
                }
            }
        );

        if (!response.ok) {
            throw new Error(
                `فشل الوصول للمصدر: HTTP ${response.status}`
            );
        }

        const contentLength =
            Number(response.headers.get("content-length") || 0);

        if (
            Number.isFinite(contentLength) &&
            contentLength > MAX_URL_BYTES
        ) {
            throw new Error(
                "حجم المصدر أكبر من الحد المسموح."
            );
        }

        const contentType =
            response.headers.get("content-type") || "";

        if (
            !(
                contentType.includes("text/") ||
                contentType.includes("json") ||
                contentType.includes("csv") ||
                contentType.includes("javascript") ||
                contentType.includes("xml")
            )
        ) {
            throw new Error(
                "نوع المحتوى غير مدعوم في هذه المرحلة."
            );
        }

        const text = await response.text();

        if (
            Buffer.byteLength(text, "utf8") >
            MAX_URL_BYTES
        ) {
            throw new Error(
                "المصدر أكبر من الحد المسموح."
            );
        }

        return {
            text,
            contentType
        };
    } finally {
        clearTimeout(timer);
    }
}

app.get("/api/health", (req, res) => {
    const db = readDB();

    res.json({
        success: true,
        name: "NOVA DATA AI",
        status: "online",
        version: "1.0.0",
        time: now(),
        datasets: db.datasets.length,
        projects: db.projects.length,
        requestId: req.requestId
    });
});

app.get("/api/stats", (req, res) => {
    const db = readDB();

    let records = 0;

    for (const dataset of db.datasets) {
        records += safeNumber(
            dataset.recordCount,
            Array.isArray(dataset.records)
                ? dataset.records.length
                : 0
        );
    }

    const qualities = db.datasets
        .map(dataset =>
            safeNumber(dataset.quality?.quality, 0)
        )
        .filter(value => value > 0);

    const averageQuality =
        qualities.length > 0
            ? Math.round(
                  qualities.reduce(
                      (sum, value) => sum + value,
                      0
                  ) / qualities.length
              )
            : 0;

    res.json({
        success: true,
        stats: {
            datasets: db.datasets.length,
            records,
            projects: db.projects.length,
            operations: db.operations.length,
            averageQuality
        }
    });
});

app.get("/api/datasets", (req, res) => {
    const db = readDB();

    const datasets = db.datasets.map(dataset => ({
        id: dataset.id,
        name: dataset.name,
        type: dataset.type,
        source: dataset.source,
        recordCount: dataset.recordCount,
        status: dataset.status,
        quality: dataset.quality,
        createdAt: dataset.createdAt,
        updatedAt: dataset.updatedAt
    }));

    res.json({
        success: true,
        count: datasets.length,
        datasets
    });
});

app.get("/api/datasets/:id", (req, res) => {
    const db = readDB();

    const dataset = findDataset(
        db,
        cleanText(req.params.id, 100)
    );

    if (!dataset) {
        return res.status(404).json({
            success: false,
            error: "Dataset غير موجود."
        });
    }

    res.json({
        success: true,
        dataset
    });
});

app.post("/api/dataset/create", (req, res) => {
    try {
        const db = readDB();

        const {
            name,
            type,
            records,
            source,
            metadata
        } = req.body || {};

        if (!Array.isArray(records)) {
            return res.status(400).json({
                success: false,
                error: "records يجب أن تكون مصفوفة."
            });
        }

        if (records.length > 100000) {
            return res.status(413).json({
                success: false,
                error:
                    "عدد السجلات أكبر من الحد المسموح لهذه العملية."
            });
        }

        const dataset = createDataset({
            name,
            type,
            records,
            source,
            metadata
        });

        db.datasets.unshift(dataset);

        addOperation(db, {
            type: "dataset_created",
            datasetId: dataset.id,
            records: dataset.recordCount
        });

        writeDB(db);

        res.status(201).json({
            success: true,
            dataset
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر إنشاء Dataset.",
            requestId: req.requestId
        });
    }
});

app.post("/api/collect/manual", (req, res) => {
    try {
        const db = readDB();

        const {
            name,
            type,
            data,
            format = "auto"
        } = req.body || {};

        if (
            data === undefined ||
            data === null ||
            String(data).trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                error: "لم يتم إرسال بيانات."
            });
        }

        const records = Array.isArray(data)
            ? data
            : parseTextData(data, format);

        const dataset = createDataset({
            name,
            type,
            records,
            source: {
                type: "manual"
            }
        });

        db.datasets.unshift(dataset);

        addOperation(db, {
            type: "manual_collection",
            datasetId: dataset.id,
            records: dataset.recordCount
        });

        writeDB(db);

        res.status(201).json({
            success: true,
            message: "تم جمع البيانات اليدوية.",
            dataset
        });
    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            error:
                error.message ||
                "تعذر معالجة البيانات اليدوية.",
            requestId: req.requestId
        });
    }
});

app.post("/api/collect/url", async (req, res) => {
    try {
        const {
            url,
            name,
            type = "web"
        } = req.body || {};

        if (!url) {
            return res.status(400).json({
                success: false,
                error: "يجب إدخال الرابط."
            });
        }

        const result = await fetchRemoteData(
            cleanText(url, 2000)
        );

        const records = parseTextData(
            result.text,
            result.contentType.includes("json")
                ? "json"
                : result.contentType.includes("csv")
                ? "csv"
                : "text"
        );

        const db = readDB();

        const dataset = createDataset({
            name:
                name ||
                `Web Collection ${new Date().toLocaleDateString(
                    "ar"
                )}`,
            type,
            records,
            source: {
                type: "url",
                url: cleanText(url, 2000),
                contentType: result.contentType
            }
        });

        db.datasets.unshift(dataset);

        db.collections.unshift({
            id: id("collection"),
            type: "url",
            url: cleanText(url, 2000),
            datasetId: dataset.id,
            createdAt: now(),
            status: "completed"
        });

        addOperation(db, {
            type: "url_collection",
            datasetId: dataset.id,
            url: cleanText(url, 2000),
            records: dataset.recordCount
        });

        writeDB(db);

        res.status(201).json({
            success: true,
            message: "تم جمع البيانات من الرابط.",
            dataset
        });
    } catch (error) {
        console.error(error);

        res.status(400).json({
            success: false,
            error:
                error.name === "AbortError"
                    ? "انتهت مهلة الاتصال بالمصدر."
                    : error.message ||
                      "تعذر جمع البيانات من الرابط.",
            requestId: req.requestId
        });
    }
});

app.post("/api/dataset/:id/analyze", (req, res) => {
    try {
        const db = readDB();

        const dataset = findDataset(
            db,
            cleanText(req.params.id, 100)
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                error: "Dataset غير موجود."
            });
        }

        dataset.quality = {
            ...analyzeRecords(dataset.records),
            sensitiveFindings:
                detectSensitiveData(dataset.records).length
        };

        dataset.updatedAt = now();

        dataset.history.push({
            action: "analyzed",
            at: now()
        });

        addOperation(db, {
            type: "dataset_analyzed",
            datasetId: dataset.id,
            quality: dataset.quality.quality
        });

        writeDB(db);

        res.json({
            success: true,
            analysis: dataset.quality
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر تحليل Dataset."
        });
    }
});

app.post("/api/dataset/:id/clean", (req, res) => {
    try {
        const db = readDB();

        const dataset = findDataset(
            db,
            cleanText(req.params.id, 100)
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                error: "Dataset غير موجود."
            });
        }

        const before = dataset.records.length;

        let records = removeEmptyRecords(
            dataset.records
        );

        const afterEmptyRemoval = records.length;

        records = removeDuplicates(records);

        const afterDeduplication = records.length;

        records = normalizeRecords(records);

        dataset.records = records;
        dataset.recordCount = records.length;
        dataset.status = "cleaned";
        dataset.updatedAt = now();

        dataset.quality = {
            ...analyzeRecords(records),
            sensitiveFindings:
                detectSensitiveData(records).length
        };

        dataset.history.push({
            action: "cleaned",
            at: now(),
            details: {
                before,
                removedEmpty:
                    before - afterEmptyRemoval,
                removedDuplicates:
                    afterEmptyRemoval -
                    afterDeduplication,
                after: records.length
            }
        });

        addOperation(db, {
            type: "dataset_cleaned",
            datasetId: dataset.id,
            before,
            after: records.length
        });

        writeDB(db);

        res.json({
            success: true,
            message: "تم تنظيف Dataset.",
            statistics: {
                before,
                removedEmpty:
                    before - afterEmptyRemoval,
                removedDuplicates:
                    afterEmptyRemoval -
                    afterDeduplication,
                after: records.length
            },
            quality: dataset.quality
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر تنظيف Dataset."
        });
    }
});

app.post("/api/dataset/:id/privacy-scan", (req, res) => {
    try {
        const db = readDB();

        const dataset = findDataset(
            db,
            cleanText(req.params.id, 100)
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                error: "Dataset غير موجود."
            });
        }

        const findings = detectSensitiveData(
            dataset.records
        );

        dataset.quality.sensitiveFindings =
            findings.length;

        dataset.quality.privacyStatus =
            findings.length === 0
                ? "no-obvious-findings"
                : "review-required";

        dataset.updatedAt = now();

        dataset.history.push({
            action: "privacy_scan",
            at: now(),
            findings: findings.length
        });

        addOperation(db, {
            type: "privacy_scan",
            datasetId: dataset.id,
            findings: findings.length
        });

        writeDB(db);

        res.json({
            success: true,
            privacy: {
                status:
                    dataset.quality.privacyStatus,
                findingsCount: findings.length,
                findings
            }
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر فحص الخصوصية."
        });
    }
});

app.post("/api/dataset/:id/prepare", (req, res) => {
    try {
        const db = readDB();

        const dataset = findDataset(
            db,
            cleanText(req.params.id, 100)
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                error: "Dataset غير موجود."
            });
        }

        const records = removeDuplicates(
            removeEmptyRecords(
                normalizeRecords(dataset.records)
            )
        );

        const quality = analyzeRecords(records);

        const privacyFindings =
            detectSensitiveData(records);

        dataset.records = records;
        dataset.recordCount = records.length;
        dataset.quality = {
            ...quality,
            sensitiveFindings:
                privacyFindings.length,
            privacyStatus:
                privacyFindings.length === 0
                    ? "no-obvious-findings"
                    : "review-required"
        };

        dataset.status =
            privacyFindings.length === 0
                ? "ready_for_review"
                : "privacy_review_required";

        dataset.updatedAt = now();

        dataset.history.push({
            action: "prepared_for_training",
            at: now()
        });

        addOperation(db, {
            type: "dataset_prepared",
            datasetId: dataset.id,
            records: dataset.recordCount,
            quality: dataset.quality.quality
        });

        writeDB(db);

        res.json({
            success: true,
            message:
                "تم تجهيز Dataset للمراجعة قبل التدريب.",
            dataset: {
                id: dataset.id,
                name: dataset.name,
                recordCount:
                    dataset.recordCount,
                status: dataset.status,
                quality: dataset.quality
            }
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error:
                "تعذر تجهيز Dataset للتدريب."
        });
    }
});

app.get("/api/dataset/:id/export/json", (req, res) => {
    try {
        const db = readDB();

        const dataset = findDataset(
            db,
            cleanText(req.params.id, 100)
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                error: "Dataset غير موجود."
            });
        }

        const filename =
            dataset.name
                .replace(/[^\p{L}\p{N}_-]+/gu, "_")
                .slice(0, 80) ||
            "nova_dataset";

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}.json"`
        );

        res.json({
            name: dataset.name,
            type: dataset.type,
            records: dataset.records,
            quality: dataset.quality,
            exportedAt: now()
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر تصدير Dataset."
        });
    }
});

app.get("/api/projects", (req, res) => {
    const db = readDB();

    res.json({
        success: true,
        count: db.projects.length,
        projects: db.projects
    });
});

app.post("/api/projects", (req, res) => {
    try {
        const db = readDB();

        const {
            name,
            description,
            source
        } = req.body || {};

        if (!cleanText(name, 150)) {
            return res.status(400).json({
                success: false,
                error: "اسم المشروع مطلوب."
            });
        }

        const project = {
            id: id("project"),
            name: cleanText(name, 150),
            description: cleanText(
                description,
                2000
            ),
            source: source || null,
            status: "active",
            createdAt: now(),
            updatedAt: now()
        };

        db.projects.unshift(project);

        addOperation(db, {
            type: "project_created",
            projectId: project.id
        });

        writeDB(db);

        res.status(201).json({
            success: true,
            project
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر إنشاء المشروع."
        });
    }
});

app.get("/api/operations", (req, res) => {
    const db = readDB();

    const limit = clamp(
        safeNumber(req.query.limit, 50),
        1,
        200
    );

    res.json({
        success: true,
        operations: db.operations.slice(
            0,
            limit
        )
    });
});

app.get("/api/settings", (req, res) => {
    const db = readDB();

    res.json({
        success: true,
        settings: db.settings
    });
});

app.post("/api/settings", (req, res) => {
    try {
        const db = readDB();

        const {
            platformName,
            validationLevel
        } = req.body || {};

        if (platformName !== undefined) {
            db.settings.platformName =
                cleanText(
                    platformName,
                    150
                ) || "NOVA DATA AI";
        }

        if (validationLevel !== undefined) {
            const allowed = [
                "basic",
                "standard",
                "strict"
            ];

            if (
                allowed.includes(
                    validationLevel
                )
            ) {
                db.settings.validationLevel =
                    validationLevel;
            }
        }

        addOperation(db, {
            type: "settings_updated"
        });

        writeDB(db);

        res.json({
            success: true,
            settings: db.settings
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            error: "تعذر حفظ الإعدادات."
        });
    }
});

app.get("/", (req, res) => {
    if (!fs.existsSync(INDEX_FILE)) {
        return res.status(404).send(
            "index.html غير موجود."
        );
    }

    res.sendFile(INDEX_FILE);
});

app.use(express.static(ROOT, {
    index: false,
    dotfiles: "deny",
    extensions: ["html"]
}));

app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({
            success: false,
            error: "API endpoint غير موجود.",
            requestId: req.requestId
        });
    }

    res.status(404).send(
        "الصفحة المطلوبة غير موجودة."
    );
});

app.use((error, req, res, next) => {
    console.error(
        "Unhandled server error:",
        error
    );

    if (res.headersSent) {
        return next(error);
    }

    res.status(
        error.status || 500
    ).json({
        success: false,
        error:
            "حدث خطأ داخلي في NOVA DATA AI.",
        requestId: req.requestId
    });
});

ensureStorage();

app.listen(PORT, HOST, () => {
    console.log("");
    console.log(
        "=========================================="
    );
    console.log(
        "        NOVA DATA AI SERVER"
    );
    console.log(
        "=========================================="
    );
    console.log(
        `Server: http://localhost:${PORT}`
    );
    console.log(
        `Health: http://localhost:${PORT}/api/health`
    );
    console.log(
        "Status: ONLINE"
    );
    console.log(
        "=========================================="
    );
    console.log("");
});
