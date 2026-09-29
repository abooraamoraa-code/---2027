"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * FILE PROCESSING ENGINE
 * File: file-engine.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - قراءة الملفات المحلية
 * - اكتشاف نوع الملف
 * - قراءة TXT
 * - قراءة JSON
 * - قراءة CSV
 * - تحليل أسماء الامتدادات
 * - إنشاء Dataset مبدئي
 * - إنشاء تقارير للملفات
 * - حماية من الملفات غير المدعومة
 *
 * ملاحظات:
 * - لا يحتاج API Key.
 * - يعمل محليًا.
 * - يستخدم Node.js فقط.
 * - دعم Excel/PDF والصور والفيديو يمكن إضافته
 *   في محركات متخصصة لاحقًا.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ============================================================
   إعدادات المحرك
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_FILE_BYTES:
        25 * 1024 * 1024,

    MAX_RECORDS:
        250000,

    MAX_TEXT_LENGTH:
        10 * 1024 * 1024,

    SUPPORTED_EXTENSIONS: [
        ".txt",
        ".text",
        ".json",
        ".jsonl",
        ".ndjson",
        ".csv"
    ],

    EXTENSION_TYPES: {
        ".txt": "text",
        ".text": "text",
        ".json": "json",
        ".jsonl": "jsonl",
        ".ndjson": "jsonl",
        ".csv": "csv"
    },

    BLOCKED_EXTENSIONS: [
        ".exe",
        ".msi",
        ".bat",
        ".cmd",
        ".com",
        ".scr",
        ".ps1",
        ".vbs",
        ".js",
        ".jar",
        ".dll",
        ".sys",
        ".sh",
        ".php",
        ".asp",
        ".aspx",
        ".cgi"
    ]
});

/* ============================================================
   خطأ المحرك
============================================================ */

class FileEngineError extends Error {
    constructor(
        message,
        code = "FILE_ENGINE_ERROR",
        details = {}
    ) {
        super(message);

        this.name = "FileEngineError";
        this.code = code;
        this.details = details;
    }
}

/* ============================================================
   أدوات عامة
============================================================ */

function makeId(prefix = "file") {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date().toISOString();
}

function cleanText(
    value,
    max = 100000
) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(value)
        .replace(/\u0000/g, "")
        .slice(0, max);
}

function getExtension(filePath) {
    return path
        .extname(
            String(filePath || "")
        )
        .toLowerCase();
}

function normalizeFileName(
    filePath
) {
    return path.basename(
        String(filePath || "")
    );
}

function normalizePath(
    filePath
) {
    if (
        typeof filePath !==
        "string"
    ) {
        throw new FileEngineError(
            "مسار الملف غير صالح.",
            "INVALID_PATH"
        );
    }

    const resolved =
        path.resolve(
            filePath
        );

    return resolved;
}

function createHash(
    buffer
) {
    return crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");
}

/* ============================================================
   التحقق من الملف
============================================================ */

function assertFileExists(
    filePath
) {
    if (
        !fs.existsSync(
            filePath
        )
    ) {
        throw new FileEngineError(
            "الملف غير موجود.",
            "FILE_NOT_FOUND",
            {
                path: filePath
            }
        );
    }

    const stats =
        fs.statSync(
            filePath
        );

    if (!stats.isFile()) {
        throw new FileEngineError(
            "المسار لا يشير إلى ملف.",
            "NOT_A_FILE"
        );
    }

    return stats;
}

function validateFileSize(
    stats,
    maxBytes =
        CONFIG.MAX_FILE_BYTES
) {
    if (
        stats.size >
        maxBytes
    ) {
        throw new FileEngineError(
            "حجم الملف أكبر من الحد المسموح.",
            "FILE_TOO_LARGE",
            {
                size:
                    stats.size,

                maxBytes
            }
        );
    }

    return true;
}

function validateExtension(
    extension
) {
    if (
        CONFIG.BLOCKED_EXTENSIONS.includes(
            extension
        )
    ) {
        throw new FileEngineError(
            `امتداد الملف غير مسموح: ${extension}`,
            "BLOCKED_EXTENSION",
            {
                extension
            }
        );
    }

    if (
        !CONFIG.SUPPORTED_EXTENSIONS.includes(
            extension
        )
    ) {
        throw new FileEngineError(
            `امتداد الملف غير مدعوم حاليًا: ${extension || "بدون امتداد"}`,
            "UNSUPPORTED_EXTENSION",
            {
                extension
            }
        );
    }

    return true;
}

/* ============================================================
   اكتشاف النوع
============================================================ */

function detectFileType(
    filePath,
    providedType = ""
) {
    const extension =
        getExtension(
            filePath
        );

    const mapped =
        CONFIG.EXTENSION_TYPES[
            extension
        ];

    if (mapped) {
        return mapped;
    }

    const input =
        String(
            providedType || ""
        )
            .toLowerCase()
            .trim();

    if (
        input.includes(
            "json"
        )
    ) {
        return "json";
    }

    if (
        input.includes(
            "csv"
        )
    ) {
        return "csv";
    }

    if (
        input.includes(
            "text"
        ) ||
        input.includes(
            "plain"
        )
    ) {
        return "text";
    }

    return "unknown";
}

/* ============================================================
   قراءة Buffer
============================================================ */

function readFileBuffer(
    filePath
) {
    const resolved =
        normalizePath(
            filePath
        );

    const stats =
        assertFileExists(
            resolved
        );

    validateFileSize(
        stats
    );

    const buffer =
        fs.readFileSync(
            resolved
        );

    if (
        !Buffer.isBuffer(
            buffer
        )
    ) {
        throw new FileEngineError(
            "تعذر قراءة محتوى الملف.",
            "READ_FAILED"
        );
    }

    return {
        path:
            resolved,

        fileName:
            normalizeFileName(
                resolved
            ),

        size:
            stats.size,

        modifiedAt:
            stats.mtime.toISOString(),

        createdAt:
            stats.birthtime.toISOString(),

        buffer
    };
}

/* ============================================================
   كشف BOM وترميز النص
============================================================ */

function decodeTextBuffer(
    buffer
) {
    if (
        !Buffer.isBuffer(
            buffer
        )
    ) {
        throw new FileEngineError(
            "محتوى الملف ليس Buffer.",
            "INVALID_BUFFER"
        );
    }

    /*
     * UTF-8 BOM
     */
    if (
        buffer.length >= 3 &&
        buffer[0] === 0xef &&
        buffer[1] === 0xbb &&
        buffer[2] === 0xbf
    ) {
        return buffer
            .subarray(3)
            .toString("utf8");
    }

    /*
     * UTF-16 LE
     */
    if (
        buffer.length >= 2 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xfe
    ) {
        return buffer
            .subarray(2)
            .toString("utf16le");
    }

    /*
     * UTF-16 BE
     */
    if (
        buffer.length >= 2 &&
        buffer[0] === 0xfe &&
        buffer[1] === 0xff
    ) {
        const swapped =
            Buffer.allocUnsafe(
                buffer.length - 2
            );

        let offset = 0;

        for (
            let i = 2;
            i + 1 < buffer.length;
            i += 2
        ) {
            swapped[offset++] =
                buffer[i + 1];

            swapped[offset++] =
                buffer[i];
        }

        return swapped.toString(
            "utf16le"
        );
    }

    return buffer.toString(
        "utf8"
    );
}

/* ============================================================
   قراءة TXT
============================================================ */

function parseText(
    text
) {
    const normalized =
        String(
            text || ""
        )
            .replace(
                /\r\n/g,
                "\n"
            )
            .replace(
                /\r/g,
                "\n"
            );

    const lines =
        normalized
            .split("\n")
            .map(
                line =>
                    line.trim()
            )
            .filter(Boolean);

    return lines.map(
        (line, index) => ({
            id:
                index + 1,

            text:
                line
        })
    );
}

/* ============================================================
   قراءة JSON
============================================================ */

function parseJSON(
    text
) {
    let parsed;

    try {
        parsed =
            JSON.parse(
                String(text || "")
            );
    } catch (
        error
    ) {
        throw new FileEngineError(
            "ملف JSON غير صالح.",
            "INVALID_JSON",
            {
                message:
                    error.message
            }
        );
    }

    if (
        Array.isArray(
            parsed
        )
    ) {
        return parsed;
    }

    if (
        parsed !== null &&
        typeof parsed ===
            "object"
    ) {
        return [parsed];
    }

    return [
        {
            value:
                parsed
        }
    ];
}

/* ============================================================
   قراءة JSONL / NDJSON
============================================================ */

function parseJSONL(
    text
) {
    const lines =
        String(
            text || ""
        )
            .replace(
                /\r\n/g,
                "\n"
            )
            .replace(
                /\r/g,
                "\n"
            )
            .split("\n")
            .map(
                line =>
                    line.trim()
            )
            .filter(Boolean);

    const records = [];

    const errors = [];

    for (
        let index = 0;
        index < lines.length;
        index++
    ) {
        const line =
            lines[index];

        try {
            records.push(
                JSON.parse(
                    line
                )
            );
        } catch (
            error
        ) {
            errors.push({
                line:
                    index + 1,

                message:
                    error.message
            });
        }
    }

    if (
        records.length === 0 &&
        errors.length > 0
    ) {
        throw new FileEngineError(
            "لم يتم العثور على أي سجل JSONL صالح.",
            "INVALID_JSONL",
            {
                errors
            }
        );
    }

    return {
        records,
        errors
    };
}

/* ============================================================
   قراءة CSV
============================================================ */

function parseCSVLine(
    line
) {
    const values = [];

    let current = "";

    let quoted = false;

    for (
        let index = 0;
        index < line.length;
        index++
    ) {
        const char =
            line[index];

        if (
            char === '"'
        ) {
            if (
                quoted &&
                line[index + 1] ===
                    '"'
            ) {
                current += '"';
                index++;

                continue;
            }

            quoted =
                !quoted;

            continue;
        }

        if (
            char === "," &&
            !quoted
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

function parseCSV(
    text
) {
    const normalized =
        String(
            text || ""
        )
            .replace(
                /\r\n/g,
                "\n"
            )
            .replace(
                /\r/g,
                "\n"
            );

    const lines =
        normalized
            .split("\n")
            .filter(
                line =>
                    line.trim() !== ""
            );

    if (
        lines.length === 0
    ) {
        return [];
    }

    const headers =
        parseCSVLine(
            lines[0]
        ).map(
            (
                header,
                index
            ) => {
                const value =
                    header
                        .trim();

                return (
                    value ||
                    `column_${index + 1}`
                );
            }
        );

    const records = [];

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
            columnIndex <
            headers.length;
            columnIndex++
        ) {
            record[
                headers[
                    columnIndex
                ]
            ] =
                values[
                    columnIndex
                ] ??
                "";
        }

        records.push(
            record
        );
    }

    return records;
}

/* ============================================================
   كشف CSV تلقائيًا
============================================================ */

function looksLikeCSV(
    text
) {
    const sample =
        String(
            text || ""
        )
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(0, 5);

    if (
        sample.length <
        2
    ) {
        return false;
    }

    const commaCounts =
        sample.map(
            line =>
                (
                    line.match(
                        /,/g
                    ) || []
                ).length
        );

    return (
        commaCounts[0] > 0 &&
        commaCounts.every(
            count =>
                count ===
                commaCounts[0]
        )
    );
}

/* ============================================================
   تنظيف أولي للسجلات
============================================================ */

function normalizeRecord(
    record
) {
    if (
        record === null ||
        record === undefined
    ) {
        return {
            value:
                null
        };
    }

    if (
        typeof record ===
            "string"
    ) {
        return {
            text:
                record.trim()
        };
    }

    if (
        typeof record ===
        "number"
    ) {
        return {
            value:
                record
        };
    }

    if (
        typeof record ===
        "boolean"
    ) {
        return {
            value:
                record
        };
    }

    if (
        Array.isArray(
            record
        )
    ) {
        return {
            values:
                record
        };
    }

    if (
        typeof record ===
        "object"
    ) {
        const output =
            {};

        for (
            const [
                key,
                value
            ] of Object.entries(
                record
            )
        ) {
            const cleanKey =
                String(
                    key
                )
                    .trim()
                    .replace(
                        /\s+/g,
                        "_"
                    );

            output[
                cleanKey ||
                    "field"
            ] =
                typeof value ===
                    "string"
                    ? value.trim()
                    : value;
        }

        return output;
    }

    return {
        value:
            String(record)
    };
}

function normalizeRecords(
    records
) {
    return records
        .map(
            normalizeRecord
        );
}

/* ============================================================
   إزالة السجلات الفارغة
============================================================ */

function isEmptyRecord(
    record
) {
    if (
        record === null ||
        record === undefined
    ) {
        return true;
    }

    if (
        typeof record ===
            "string"
    ) {
        return (
            record.trim()
                .length === 0
        );
    }

    if (
        Array.isArray(
            record
        )
    ) {
        return (
            record.length ===
            0
        );
    }

    if (
        typeof record ===
            "object"
    ) {
        const values =
            Object.values(
                record
            );

        if (
            values.length ===
            0
        ) {
            return true;
        }

        return values.every(
            value => {
                if (
                    value ===
                        null ||
                    value ===
                        undefined
                ) {
                    return true;
                }

                if (
                    typeof value ===
                        "string"
                ) {
                    return (
                        value.trim() ===
                        ""
                    );
                }

                if (
                    Array.isArray(
                        value
                    )
                ) {
                    return (
                        value.length ===
                        0
                    );
                }

                return false;
            }
        );
    }

    return false;
}

function removeEmptyRecords(
    records
) {
    return records.filter(
        record =>
            !isEmptyRecord(
                record
            )
    );
}

/* ============================================================
   الحد الأقصى للسجلات
============================================================ */

function validateRecordCount(
    records
) {
    if (
        !Array.isArray(
            records
        )
    ) {
        throw new FileEngineError(
            "السجلات ليست مصفوفة.",
            "INVALID_RECORDS"
        );
    }

    if (
        records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new FileEngineError(
            "عدد السجلات أكبر من الحد المسموح.",
            "TOO_MANY_RECORDS",
            {
                count:
                    records.length,

                max:
                    CONFIG.MAX_RECORDS
            }
        );
    }

    return true;
}

/* ============================================================
   تحليل الملف
============================================================ */

function analyzeFileMetadata(
    fileInfo,
    records,
    fileType
) {
    const fields =
        new Set();

    let objectRecords = 0;
    let primitiveRecords = 0;

    for (
        const record of
            records
    ) {
        if (
            record !== null &&
            typeof record ===
                "object" &&
            !Array.isArray(
                record
            )
        ) {
            objectRecords++;

            for (
                const field of
                    Object.keys(
                        record
                    )
            ) {
                fields.add(
                    field
                );
            }
        } else {
            primitiveRecords++;
        }
    }

    return {
        file: {
            name:
                fileInfo.fileName,

            path:
                fileInfo.path,

            size:
                fileInfo.size,

            modifiedAt:
                fileInfo.modifiedAt
        },

        type:
            fileType,

        records:
            records.length,

        fields:
            [...fields],

        fieldCount:
            fields.size,

        objectRecords,

        primitiveRecords
    };
}

/* ============================================================
   تحليل ملف واحد
============================================================ */

function inspectFile(
    filePath,
    options = {}
) {
    const resolved =
        normalizePath(
            filePath
        );

    const stats =
        assertFileExists(
            resolved
        );

    validateFileSize(
        stats,
        options.maxBytes ||
            CONFIG.MAX_FILE_BYTES
    );

    const extension =
        getExtension(
            resolved
        );

    validateExtension(
        extension
    );

    const fileType =
        detectFileType(
            resolved,
            options.type
        );

    return {
        id:
            makeId("file"),

        path:
            resolved,

        name:
            normalizeFileName(
                resolved
            ),

        extension,

        type:
            fileType,

        size:
            stats.size,

        modifiedAt:
            stats.mtime.toISOString(),

        createdAt:
            stats.birthtime.toISOString()
    };
}

/* ============================================================
   معالجة ملف
============================================================ */

function processFile(
    filePath,
    options = {}
) {
    const startedAt =
        now();

    const resolved =
        normalizePath(
            filePath
        );

    const raw =
        readFileBuffer(
            resolved
        );

    const extension =
        getExtension(
            resolved
        );

    validateExtension(
        extension
    );

    const fileType =
        detectFileType(
            resolved,
            options.type
        );

    let text =
        "";

    let records =
        [];

    let parser =
        "";

    let parserErrors =
        [];

    /*
     * الملفات النصية الحالية
     */
    switch (fileType) {
        case "text":
            text =
                decodeTextBuffer(
                    raw.buffer
                );

            if (
                text.length >
                (
                    options.maxTextLength ||
                    CONFIG.MAX_TEXT_LENGTH
                )
            ) {
                throw new FileEngineError(
                    "النص أكبر من الحد المسموح.",
                    "TEXT_TOO_LARGE"
                );
            }

            records =
                parseText(
                    text
                );

            parser =
                "text";
            break;

        case "json":
            text =
                decodeTextBuffer(
                    raw.buffer
                );

            records =
                parseJSON(
                    text
                );

            parser =
                "json";
            break;

        case "jsonl": {
            text =
                decodeTextBuffer(
                    raw.buffer
                );

            const result =
                parseJSONL(
                    text
                );

            records =
                result.records;

            parserErrors =
                result.errors;

            parser =
                "jsonl";
            break;
        }

        case "csv":
            text =
                decodeTextBuffer(
                    raw.buffer
                );

            records =
                parseCSV(
                    text
                );

            parser =
                "csv";
            break;

        default:
            /*
             * يجب ألا نصل هنا بعد validateExtension
             */
            throw new FileEngineError(
                "نوع الملف غير مدعوم.",
                "UNSUPPORTED_FILE_TYPE"
            );
    }

    validateRecordCount(
        records
    );

    const normalized =
        normalizeRecords(
            records
        );

    const withoutEmpty =
        removeEmptyRecords(
            normalized
        );

    const metadata =
        analyzeFileMetadata(
            raw,
            withoutEmpty,
            fileType
        );

    const finishedAt =
        now();

    return {
        success:
            true,

        operationId:
            makeId(
                "file_operation"
            ),

        file: {
            id:
                makeId("source"),

            name:
                raw.fileName,

            path:
                raw.path,

            extension,

            type:
                fileType,

            size:
                raw.size,

            sha256:
                createHash(
                    raw.buffer
                )
        },

        parser: {
            name:
                parser,

            errors:
                parserErrors
        },

        records
