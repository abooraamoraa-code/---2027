"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * DATASET EXPORT ENGINE
 * File: exporter.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - تصدير البيانات إلى JSON
 * - تصدير البيانات إلى JSONL
 * - تصدير البيانات إلى CSV
 * - تصدير TXT
 * - إنشاء Manifest
 * - إنشاء تقارير التصدير
 * - حساب SHA-256
 * - التحقق من صحة Dataset قبل التصدير
 *
 * لا يحتاج API Key.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ============================================================
   الإعدادات
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_RECORDS: 250000,

    MAX_OUTPUT_BYTES:
        100 * 1024 * 1024,

    DEFAULT_ENCODING:
        "utf8",

    SUPPORTED_FORMATS: [
        "json",
        "jsonl",
        "csv",
        "txt"
    ],

    CSV_DELIMITER:
        ","
});

/* ============================================================
   خطأ المحرك
============================================================ */

class ExporterError extends Error {
    constructor(
        message,
        code = "EXPORTER_ERROR",
        details = {}
    ) {
        super(message);

        this.name =
            "ExporterError";

        this.code =
            code;

        this.details =
            details;
    }
}

/* ============================================================
   أدوات عامة
============================================================ */

function makeId(
    prefix = "export"
) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date().toISOString();
}

function safeArray(
    value
) {
    return Array.isArray(
        value
    )
        ? value
        : [];
}

function cleanFileName(
    value
) {
    const name =
        String(
            value ||
                "nova_dataset"
        )
            .trim();

    return (
        name
            .replace(
                /[<>:"/\\|?*\u0000-\u001F]/g,
                "_"
            )
            .replace(
                /\s+/g,
                "_"
            )
            .slice(0, 120) ||
        "nova_dataset"
    );
}

function ensureDirectory(
    directory
) {
    if (
        !fs.existsSync(
            directory
        )
    ) {
        fs.mkdirSync(
            directory,
            {
                recursive:
                    true
            }
        );
    }

    return directory;
}

function sha256(
    data
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            data
        )
        .digest(
            "hex"
        );
}

/* ============================================================
   التحقق من Dataset
============================================================ */

function validateRecords(
    records
) {
    if (
        !Array.isArray(
            records
        )
    ) {
        throw new ExporterError(
            "records يجب أن تكون مصفوفة.",
            "INVALID_RECORDS"
        );
    }

    if (
        records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new ExporterError(
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

function validateFormat(
    format
) {
    const normalized =
        String(
            format || ""
        )
            .trim()
            .toLowerCase();

    if (
        !CONFIG.SUPPORTED_FORMATS.includes(
            normalized
        )
    ) {
        throw new ExporterError(
            `صيغة التصدير غير مدعومة: ${format}`,
            "UNSUPPORTED_FORMAT",
            {
                supported:
                    CONFIG.SUPPORTED_FORMATS
            }
        );
    }

    return normalized;
}

/* ============================================================
   Stable Serialize
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
        Array.isArray(
            value
        )
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(",")}]`;
    }

    const keys =
        Object.keys(
            value
        ).sort();

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

/* ============================================================
   JSON
============================================================ */

function recordsToJSON(
    records,
    options = {}
) {
    validateRecords(
        records
    );

    const payload =
        options.wrap === false
            ? records
            : {
                  version:
                      "1.0",

                  exportedBy:
                      "NOVA DATA AI",

                  exportedAt:
                      now(),

                  recordCount:
                      records.length,

                  records
              };

    return JSON.stringify(
        payload,
        null,
        options.pretty === false
            ? 0
            : 2
    );
}

/* ============================================================
   JSONL
============================================================ */

function recordsToJSONL(
    records
) {
    validateRecords(
        records
    );

    return (
        records
            .map(
                record =>
                    JSON.stringify(
                        record
                    )
            )
            .join("\n") +
        (
            records.length
                ? "\n"
                : ""
        )
    );
}

/* ============================================================
   القيمة المستخدمة في CSV
============================================================ */

function csvCell(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    if (
        typeof value ===
        "object"
    ) {
        return JSON.stringify(
            value
        );
    }

    return String(
        value
    );
}

function escapeCSV(
    value,
    delimiter =
        CONFIG.CSV_DELIMITER
) {
    const text =
        csvCell(
            value
        );

    const needsQuotes =
        text.includes(
            '"'
        ) ||
        text.includes(
            "\n"
        ) ||
        text.includes(
            "\r"
        ) ||
        text.includes(
            delimiter
        );

    const escaped =
        text.replace(
            /"/g,
            '""'
        );

    return needsQuotes
        ? `"${escaped}"`
        : escaped;
}

/* ============================================================
   اكتشاف الأعمدة
============================================================ */

function collectCSVColumns(
    records,
    preferredColumns = []
) {
    const columns =
        [];

    const seen =
        new Set();

    for (
        const column of
            safeArray(
                preferredColumns
            )
    ) {
        const name =
            String(
                column
            ).trim();

        if (
            name &&
            !seen.has(
                name
            )
        ) {
            seen.add(
                name
            );

            columns.push(
                name
            );
        }
    }

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
            for (
                const key of
                    Object.keys(
                        record
                    )
            ) {
                if (
                    !seen.has(
                        key
                    )
                ) {
                    seen.add(
                        key
                    );

                    columns.push(
                        key
                    );
                }
            }
        }
    }

    if (
        columns.length ===
        0 &&
        records.length > 0
    ) {
        columns.push(
            "value"
        );
    }

    return columns;
}

/* ============================================================
   تحويل السجل إلى صف CSV
============================================================ */

function recordToCSVRow(
    record,
    columns,
    options = {}
) {
    if (
        record === null ||
        record === undefined
    ) {
        return columns
            .map(
                () =>
                    ""
            )
            .join(
                options.delimiter ||
                    CONFIG.CSV_DELIMITER
            );
    }

    /*
     * السجل الكائني
     */
    if (
        typeof record ===
            "object" &&
        !Array.isArray(
            record
        )
    ) {
        return columns
            .map(
                column =>
                    escapeCSV(
                        record[
                            column
                        ],
                        options.delimiter ||
                            CONFIG.CSV_DELIMITER
                    )
            )
            .join(
                options.delimiter ||
                    CONFIG.CSV_DELIMITER
            );
    }

    /*
     * السجلات البسيطة
     */
    const delimiter =
        options.delimiter ||
        CONFIG.CSV_DELIMITER;

    if (
        columns.length === 1
    ) {
        return escapeCSV(
            record,
            delimiter
        );
    }

    return [
        escapeCSV(
            record,
            delimiter
        ),
        ...columns
            .slice(1)
            .map(
                () => ""
            )
    ].join(
        delimiter
    );
}

/* ============================================================
   CSV
============================================================ */

function recordsToCSV(
    records,
    options = {}
) {
    validateRecords(
        records
    );

    const delimiter =
        options.delimiter ||
        CONFIG.CSV_DELIMITER;

    const columns =
        collectCSVColumns(
            records,
            options.columns
        );

    if (
        columns.length ===
        0
    ) {
        return "";
    }

    const header =
        columns
            .map(
                column =>
                    escapeCSV(
                        column,
                        delimiter
                    )
            )
            .join(
                delimiter
            );

    const rows =
        records.map(
            record =>
                recordToCSVRow(
                    record,
                    columns,
                    {
                        delimiter
                    }
                )
        );

    return [
        header,
        ...rows
    ].join("\n") + "\n";
}

/* ============================================================
   TXT
============================================================ */

function recordToText(
    record
) {
    if (
        record === null ||
        record === undefined
    ) {
        return "";
    }

    if (
        typeof record ===
        "string"
    ) {
        return record;
    }

    if (
        typeof record ===
        "object"
    ) {
        return JSON.stringify(
            record
        );
    }

    return String(
        record
    );
}

function recordsToTXT(
    records
) {
    validateRecords(
        records
    );

    return (
        records
            .map(
                record =>
                    recordToText(
                        record
                    )
            )
            .join("\n") +
        (
            records.length
                ? "\n"
                : ""
        )
    );
}

/* ============================================================
   تحويل Dataset إلى نص
============================================================ */

function serializeDataset(
    records,
    format,
    options = {}
) {
    const normalized =
        validateFormat(
            format
        );

    switch (normalized) {
        case "json":
            return recordsToJSON(
                records,
                options
            );

        case "jsonl":
            return recordsToJSONL(
                records
            );

        case "csv":
            return recordsToCSV(
                records,
                options
            );

        case "txt":
            return recordsToTXT(
                records
            );

        default:
            throw new ExporterError(
                "صيغة غير مدعومة.",
                "UNSUPPORTED_FORMAT"
            );
    }
}

/* ============================================================
   إنشاء Manifest
============================================================ */

function createManifest({
    dataset = {},
    format,
    records,
    outputName,
    outputBytes,
    checksum
}) {
    return {
        manifestVersion:
            "1.0",

        exportId:
            makeId(
                "export"
            ),

        dataset: {
            id:
                dataset.id ||
                null,

            name:
                dataset.name ||
                outputName,

            type:
                dataset.type ||
                "unknown",

            recordCount:
                safeArray(
                    records
                ).length,

            sourceCount:
                safeArray(
                    dataset.sources
                ).length
        },

        export: {
            format:
                String(
                    format
                ).toLowerCase(),

            fileName:
                outputName,

            bytes:
                outputBytes,

            checksum:
                checksum,

            createdAt:
                now()
        },

        quality:
            dataset.quality ||
            null,

        privacy:
            dataset.privacy ||
            null,

        readiness:
            dataset.readiness ||
            null,

        engine: {
            name:
                "NOVA DATA AI Exporter",

            version:
                CONFIG.VERSION
        }
    };
}

/* ============================================================
   إنشاء التقرير
============================================================ */

function createExportReport({
    dataset,
    format,
    filePath,
    records,
    content,
    startedAt,
    options = {}
}) {
    const bytes =
        Buffer.byteLength(
            content,
            CONFIG.DEFAULT_ENCODING
        );

    const checksum =
        sha256(
            content
        );

    const fileName =
        path.basename(
            filePath
        );

    const manifest =
        createManifest({
            dataset,
            format,
            records,
            outputName:
                fileName,
            outputBytes:
                bytes,
            checksum
        });

    return {
        success:
            true,

        exportId:
            manifest.exportId,

        engine: {
            name:
                "NOVA DATA AI Exporter",

            version:
                CONFIG.VERSION
        },

        format:
            String(
                format
            ).toLowerCase(),

        file: {
            path:
                filePath,

            name:
                fileName,

            extension:
                path.extname(
                    fileName
                ),

            bytes,

            checksum
        },

        dataset: {
            id:
                dataset?.id ||
                null,

            name:
                dataset?.name ||
                null,

            records:
                safeArray(
                    records
                ).length
        },

        options,

        manifest,

        startedAt,

        finishedAt:
            now()
    };
}

/* ============================================================
   التأكد من حجم الناتج
============================================================ */

function validateOutputSize(
    content,
    maxBytes =
        CONFIG.MAX_OUTPUT_BYTES
) {
    const bytes =
        Buffer.byteLength(
            content,
            CONFIG.DEFAULT_ENCODING
        );

    if (
        bytes > maxBytes
    ) {
        throw new ExporterError(
            "حجم الناتج أكبر من الحد المسموح.",
            "OUTPUT_TOO_LARGE",
            {
                bytes,
                maxBytes
            }
        );
    }

    return bytes;
}

/* ============================================================
   تصدير إلى مجلد
============================================================ */

function exportToDirectory({
    dataset = {},
    records,
    format,
    outputDirectory,
    fileName,
    options = {}
}) {
    const startedAt =
        now();

    validateRecords(
        records
    );

    const normalizedFormat =
        validateFormat(
            format
        );

    const directory =
        ensureDirectory(
            path.resolve(
                outputDirectory ||
                    "."
            )
        );

    const baseName =
        cleanFileName(
            fileName ||
                dataset.name ||
                "nova_dataset"
        );

    const extension =
        `.${normalizedFormat}`;

    const finalName =
        baseName
            .toLowerCase()
            .endsWith(
                extension
            )
            ? baseName
            : `${baseName}${extension}`;

    const filePath =
        path.join(
            directory,
            finalName
        );

    const content =
        serializeDataset(
            records,
            normalizedFormat,
            options
        );

    validateOutputSize(
        content,
        options.maxOutputBytes ||
            CONFIG.MAX_OUTPUT_BYTES
    );

    fs.writeFileSync(
        filePath,
        content,
        CONFIG.DEFAULT_ENCODING
    );

    const report =
        createExportReport({
            dataset,
            format:
                normalizedFormat,
            filePath,
            records,
            content,
            startedAt,
            options
        });

    /*
     * حفظ manifest بجانب الملف
     */
    if (
        options.writeManifest !==
        false
    ) {
        const manifestPath =
            `${filePath}.manifest.json`;

        fs.writeFileSync(
            manifestPath,
            JSON.stringify(
                report.manifest,
                null,
                2
            ),
            CONFIG.DEFAULT_ENCODING
        );

        report.manifestPath =
            manifestPath;
    }

    return report;
}

/* ============================================================
   تصدير محتوى بدون حفظ
============================================================ */

function exportToString({
    dataset = {},
    records,
    format,
    options = {}
}) {
    const startedAt =
        now();

    validateRecords(
        records
    );

    const normalizedFormat =
        validateFormat(
            format
        );

    const content =
        serializeDataset(
            records,
            normalizedFormat,
            options
        );

    validateOutputSize(
        content,
        options.maxOutputBytes ||
            CONFIG.MAX_OUTPUT_BYTES
    );

    const bytes =
        Buffer.byteLength(
            content,
            CONFIG.DEFAULT_ENCODING
        );

    return {
        success:
            true,

        exportId:
            makeId(
                "export"
            ),

        format:
            normalizedFormat,

        bytes,

        checksum:
            sha256(
                content
            ),

        content,

        records:
            records.length,

        startedAt,

        finishedAt:
            now()
    };
}

/* ============================================================
   إنشاء عدة صيغ
============================================================ */

function exportMultipleFormats({
    dataset = {},
    records,
    outputDirectory,
    formats,
    baseFileName,
    options = {}
}) {
    validateRecords(
        records
    );

    const requested =
        Array.isArray(
            formats
        ) &&
        formats.length
            ? formats
            : CONFIG.SUPPORTED_FORMATS;

    const results =
        [];

    for (
        const format of
            requested
    ) {
        try {
            const report =
                exportToDirectory({
                    dataset,

                    records,

                    format,

                    outputDirectory,

                    fileName:
                        baseFileName,

                    options
                });

            results.push({
                success:
                    true,

                format,

                report
            });
        } catch (
            error
        ) {
            results.push({
                success:
                    false,

                format,

                error:
                    serializeError(
                        error
                    )
            });
        }
    }

    return {
        success:
            results.every(
                item =>
                    item.success
            ),

        results
    };
}

/* ============================================================
   تصدير Dataset كامل
============================================================ */

function exportDataset({
    dataset = {},
    format = "json",
    outputDirectory = ".",
    fileName,
    options = {}
}) {
    const records =
        safeArray(
            dataset.records
        );

    return exportToDirectory({
        dataset,

        records,

        format,

        outputDirectory,

        fileName:
            fileName ||
            dataset.name ||
            "nova_dataset",

        options
    });
}

/* ============================================================
   فحص ملف التصدير
============================================================ */

function inspectExport(
    filePath
) {
    const resolved =
        path.resolve(
            String(
                filePath
            )
        );

    if (
        !fs.existsSync(
            resolved
        )
    ) {
        throw new ExporterError(
            "ملف التصدير غير موجود.",
            "EXPORT_NOT_FOUND"
        );
    }

    const stats =
        fs.statSync(
            resolved
        );

    if (
        !stats.isFile()
    ) {
        throw new ExporterError(
            "المسار ليس ملفًا.",
            "NOT_A_FILE"
        );
    }

    const content =
        fs.readFileSync(
            resolved
        );

    return {
        success:
            true,

        file: {
            path:
                resolved,

            name:
                path.basename(
                    resolved
                ),

            extension:
                path.extname(
                    resolved
                ),

            bytes:
                stats.size,

            checksum:
                sha256(
                    content
                ),

            createdAt:
                stats.birthtime.toISOString(),

            modifiedAt:
                stats.mtime.toISOString()
        }
    };
}

/* ============================================================
   إنشاء ملف مضغوط بسيط غير متاح هنا
   لذلك لا ندّعي دعم ZIP.
============================================================ */

/* ============================================================
   معلومات الصيغ
============================================================ */

function getFormatInfo() {
    return [
        {
            format:
                "json",

            extension:
                ".json",

            description:
                "Dataset منظم بصيغة JSON.",

            suitableFor:
                [
                    "APIs",
                    "Applications",
                    "Data exchange"
                ]
        },

        {
            format:
                "jsonl",

            extension:
                ".jsonl",

            description:
                "كل سجل في سطر JSON مستقل.",

            suitableFor:
                [
                    "Large datasets",
                    "ML pipelines",
                    "Training pipelines"
                ]
        },

        {
            format:
                "csv",

            extension:
                ".csv",

            description:
                "بيانات جدوليّة مناسبة لبرامج الجداول والتحليل.",

            suitableFor:
                [
                    "Tabular data",
                    "Analytics",
                    "Spreadsheets"
                ]
        },

        {
            format:
                "txt",

            extension:
                ".txt",

            description:
                "سجل نصي لكل سطر.",

            suitableFor:
                [
                    "Text datasets",
                    "Simple corpora"
                ]
        }
    ];
}

/* ============================================================
   حساب Dataset Checksum
============================================================ */

function datasetChecksum(
    records
) {
    validateRecords(
        records
    );

    return sha256(
        stableSerialize(
            records
        )
    );
}

/* ============================================================
   إنشاء اسم تلقائي
============================================================ */

function generateFileName(
    datasetName,
    format
) {
    const base =
        cleanFileName(
            datasetName ||
                "nova_dataset"
        );

    const normalized =
        validateFormat(
            format
        );

    return `${base}.${normalized}`;
}

/* ============================================================
   حذف ملفات Manifest
============================================================ */

function removeManifest(
    filePath
) {
    const manifestPath =
        `${filePath}.manifest.json`;

    if (
        fs.existsSync(
            manifestPath
        )
    ) {
        fs.unlinkSync(
            manifestPath
        );

        return true;
    }

    return false;
}

/* ============================================================
   حذف تصدير
============================================================ */

function deleteExport(
    filePath
) {
    const resolved =
        path.resolve(
            String(
                filePath
            )
        );

    let deleted =
        false;

    if (
        fs.existsSync(
            resolved
        )
    ) {
        const stats =
            fs.statSync(
                resolved
            );

        if (
            !stats.isFile()
        ) {
            throw new ExporterError(
                "العنصر المطلوب حذفه ليس ملفًا.",
                "NOT_A_FILE"
            );
        }

        fs.unlinkSync(
            resolved
        );

        deleted = true;
    }

    const manifestDeleted =
        removeManifest(
            resolved
        );

    return {
        success:
            true,

        fileDeleted:
            deleted,

        manifestDeleted
    };
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Exporter",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        formats:
            getFormatInfo(),

        limits: {
            maxRecords:
                CONFIG.MAX_RECORDS,

            maxOutputBytes:
                CONFIG.MAX_OUTPUT_BYTES
        }
    };
}

/* ============================================================
   تحويل الأخطاء
============================================================ */

function serializeError(
    error
) {
    if (
        error instanceof
        ExporterError
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
            error?.code ||
            "UNKNOWN_ERROR",

        message:
            error?.message ||
            "حدث خطأ غير معروف.",

        details:
            error?.details ||
            {}
    };
}

/* ============================================================
   API
============================================================ */

const exporter =
    Object.freeze({
        version:
            CONFIG.VERSION,

        config:
            CONFIG,

        ExporterError,

        cleanFileName,

        ensureDirectory,

        sha256,

        validateRecords,

        validateFormat,

        stableSerialize,

        recordsToJSON,

        recordsToJSONL,

        csvCell,

        escapeCSV,

        collectCSVColumns,

        recordToCSVRow,

        recordsToCSV,

        recordToText,

        recordsToTXT,

        serializeDataset,

        createManifest,

        createExportReport,

        validateOutputSize,

        exportToDirectory,

        exportToString,

        exportMultipleFormats,

        exportDataset,

        inspectExport,

        getFormatInfo,

        datasetChecksum,

        generateFileName,

        removeManifest,

        deleteExport,

        getEngineInfo,

        serializeError
    });

/* ============================================================
   التصدير
============================================================ */

module.exports =
    exporter;

/* ============================================================
   اختبار مباشر
============================================================ */

if (
    require.main === module
) {
    console.log("");
    console.log(
        "================================================"
    );

    console.log(
        "       NOVA DATA AI - EXPORTER ENGINE"
    );

    console.log(
        "================================================"
    );

    console.log(
        `Version: ${CONFIG.VERSION}`
    );

    console.log(
        "Status: READY"
    );

    console.log(
        ""
    );

    console.log(
        "Supported formats:"
    );

    for (
        const item of
            getFormatInfo()
    ) {
        console.log(
            `- ${item.format} (${item.extension})`
        );
    }

    console.log("");

    const testData = [
        {
            name:
                "NOVA AI",

            age:
                14,

            city:
                "Gaza"
        },

        {
            name:
                "Data AI",

            age:
                15,

            city:
                "Palestine"
        },

        {
            name:
                "Test",

            age:
                16,

            city:
                "Nablus"
        }
    ];

    try {
        const json =
            exportToString({
                dataset: {
                    id:
                        "test_dataset",

                    name:
                        "NOVA TEST DATA",

                    type:
                        "demo"
                },

                records:
                    testData,

                format:
                    "json"
            });

        console.log(
            `JSON records: ${json.records}`
        );

        console.log(
            `JSON bytes: ${json.bytes}`
        );

        console.log(
            `JSON checksum: ${json.checksum}`
        );

        const csv =
            exportToString({
                records:
                    testData,

                format:
                    "csv"
            });

        console.log(
            `CSV bytes: ${csv.bytes}`
        );

        const jsonl =
            exportToString({
                records:
                    testData,

                format:
                    "jsonl"
            });

        console.log(
            `JSONL bytes: ${jsonl.bytes}`
        );

        console.log("");

        console.log(
            "EXPORTER TEST: SUCCESS"
        );
    } catch (
        error
    ) {
        console.error(
            "EXPORTER TEST: FAILED"
        );

        console.error(
            serializeError(
                error
            )
        );

        process.exitCode =
            1;
    }

    console.log(
        "================================================"
    );

    console.log("");
}
