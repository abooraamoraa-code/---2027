"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * MASTER DATA PROCESSING ENGINE
 * File: processor.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - ربط محركات NOVA DATA AI
 * - استقبال البيانات من مصادر متعددة
 * - جمع البيانات
 * - دمج البيانات
 * - تنظيف البيانات
 * - إزالة التكرار
 * - التحقق من الجودة
 * - فحص الخصوصية
 * - تقييم الجاهزية
 * - إنشاء سجل عمليات
 * - إنشاء تقرير معالجة كامل
 *
 * المحركات المرتبطة:
 * - collector.js
 * - cleaner.js
 * - validator.js
 * - file-engine.js
 *
 * لا يحتاج API Key لتشغيل المعالجة الأساسية.
 * ============================================================
 */

const crypto = require("crypto");

const collector = require("./collector");
const cleaner = require("./cleaner");
const validator = require("./validator");
const fileEngine = require("./file-engine");

/* ============================================================
   الإعدادات
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_RECORDS:
        250000,

    DEFAULT_BATCH_SIZE:
        1000,

    DEFAULT_SOURCE_TIMEOUT:
        15000,

    DEFAULT_MAX_SOURCE_BYTES:
        5 * 1024 * 1024,

    DEFAULT_OPTIONS: Object.freeze({
        collect: true,
        clean: true,
        validate: true,
        privacyScan: true,
        removeDuplicates: true,
        removeEmptyRecords: true,
        normalizeFieldNames: true,
        normalizeWhitespace: true,
        normalizeNumbers: true,
        normalizeBooleans: false
    })
});

/* ============================================================
   خطأ المحرك
============================================================ */

class ProcessorError extends Error {
    constructor(
        message,
        code = "PROCESSOR_ERROR",
        details = {}
    ) {
        super(message);

        this.name =
            "ProcessorError";

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
    prefix = "process"
) {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date().toISOString();
}

function cloneValue(
    value
) {
    if (
        value === undefined
    ) {
        return undefined;
    }

    return JSON.parse(
        JSON.stringify(
            value
        )
    );
}

function isObject(
    value
) {
    return (
        value !== null &&
        typeof value ===
            "object" &&
        !Array.isArray(
            value
        )
    );
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

function numberOr(
    value,
    fallback
) {
    const number =
        Number(value);

    return Number.isFinite(
        number
    )
        ? number
        : fallback;
}

/* ============================================================
   بناء سجل خطوة
============================================================ */

function createStep(
    name,
    status,
    startedAt,
    details = {}
) {
    return {
        id:
            makeId("step"),

        name,

        status,

        startedAt,

        finishedAt:
            now(),

        durationMs:
            Math.max(
                0,
                Date.now() -
                    new Date(
                        startedAt
                    ).getTime()
            ),

        details
    };
}

/* ============================================================
   دمج الخيارات
============================================================ */

function normalizeOptions(
    options = {}
) {
    return {
        ...CONFIG.DEFAULT_OPTIONS,
        ...(options || {}),

        sourceTimeout:
            numberOr(
                options.sourceTimeout,
                CONFIG.DEFAULT_SOURCE_TIMEOUT
            ),

        maxSourceBytes:
            numberOr(
                options.maxSourceBytes,
                CONFIG.DEFAULT_MAX_SOURCE_BYTES
            )
    };
}

/* ============================================================
   تطبيع المصدر
============================================================ */

function normalizeSource(
    source
) {
    if (
        typeof source ===
            "string"
    ) {
        return {
            type:
                "url",

            value:
                source
        };
    }

    if (
        source &&
        typeof source ===
            "object"
    ) {
        return {
            ...source,

            type:
                String(
                    source.type ||
                        (
                            source.url
                                ? "url"
                                : "unknown"
                        )
                ).toLowerCase()
        };
    }

    return {
        type:
            "unknown",

        value:
            source
    };
}

/* ============================================================
   مصدر URL
============================================================ */

async function collectURLSource(
    source,
    options
) {
    const normalized =
        normalizeSource(
            source
        );

    const url =
        normalized.url ||
        normalized.value;

    if (!url) {
        throw new ProcessorError(
            "مصدر URL لا يحتوي رابطًا.",
            "MISSING_SOURCE_URL"
        );
    }

    return collector.collectFromURL(
        url,
        {
            timeout:
                options.sourceTimeout,

            maxBytes:
                options.maxSourceBytes
        }
    );
}

/* ============================================================
   مصدر نصي
============================================================ */

function collectTextSource(
    source
) {
    const normalized =
        normalizeSource(
            source
        );

    return collector.collectFromText(
        normalized.text ??
            normalized.value ??
            "",
        {
            contentType:
                normalized.contentType ||
                "text/plain"
        }
    );
}

/* ============================================================
   مصدر JSON
============================================================ */

function collectJSONSource(
    source
) {
    const normalized =
        normalizeSource(
            source
        );

    return collector.collectFromJSON(
        normalized.data ??
            normalized.value
    );
}

/* ============================================================
   مصدر CSV
============================================================ */

function collectCSVSource(
    source
) {
    const normalized =
        normalizeSource(
            source
        );

    return collector.collectFromCSV(
        String(
            normalized.data ??
                normalized.value ??
                ""
        )
    );
}

/* ============================================================
   مصدر ملف
============================================================ */

function collectFileSource(
    source,
    options
) {
    const normalized =
        normalizeSource(
            source
        );

    const filePath =
        normalized.path ||
        normalized.filePath ||
        normalized.value;

    if (!filePath) {
        throw new ProcessorError(
            "مصدر الملف لا يحتوي مسارًا.",
            "MISSING_FILE_PATH"
        );
    }

    return fileEngine.processFile(
        filePath,
        {
            maxBytes:
                options.maxFileBytes
        }
    );
}

/* ============================================================
   تحويل نتيجة المصدر إلى سجلات
============================================================ */

function extractRecordsFromResult(
    result
) {
    if (!result) {
        return [];
    }

    /*
     * نتيجة Collector
     */
    if (
        Array.isArray(
            result?.collection
                ?.records
        )
    ) {
        return result.collection.records;
    }

    /*
     * نتيجة File Engine
     */
    if (
        Array.isArray(
            result.records
        )
    ) {
        return result.records;
    }

    /*
     * إذا كانت النتيجة نفسها مصفوفة
     */
    if (
        Array.isArray(result)
    ) {
        return result;
    }

    return [];
}

/* ============================================================
   جمع مصدر منفرد
============================================================ */

async function collectSource(
    source,
    options
) {
    const normalized =
        normalizeSource(
            source
        );

    const type =
        normalized.type;

    switch (type) {
        case "url":
        case "web":
        case "http":
        case "https":
            return {
                source:
                    normalized,

                result:
                    await collectURLSource(
                        normalized,
                        options
                    )
            };

        case "text":
            return {
                source:
                    normalized,

                result:
                    collectTextSource(
                        normalized
                    )
            };

        case "json":
            return {
                source:
                    normalized,

                result:
                    collectJSONSource(
                        normalized
                    )
            };

        case "csv":
            return {
                source:
                    normalized,

                result:
                    collectCSVSource(
                        normalized
                    )
            };

        case "file":
            return {
                source:
                    normalized,

                result:
                    collectFileSource(
                        normalized,
                        options
                    )
            };

        default:
            throw new ProcessorError(
                `نوع المصدر غير مدعوم: ${type}`,
                "UNSUPPORTED_SOURCE_TYPE",
                {
                    type
                }
            );
    }
}

/* ============================================================
   جمع عدة مصادر
============================================================ */

async function collectSources(
    sources,
    options
) {
    const list =
        safeArray(
            sources
        );

    const results =
        [];

    for (
        const source of
            list
    ) {
        const startedAt =
            now();

        try {
            const result =
                await collectSource(
                    source,
                    options
                );

            const records =
                extractRecordsFromResult(
                    result.result
                );

            results.push({
                success:
                    true,

                source:
                    result.source,

                records,

                result:
                    result.result,

                step:
                    createStep(
                        "collect_source",
                        "completed",
                        startedAt,
                        {
                            type:
                                result
                                    .source
                                    ?.type,

                            records:
                                records.length
                        }
                    )
            });
        } catch (
            error
        ) {
            results.push({
                success:
                    false,

                source:
                    normalizeSource(
                        source
                    ),

                records:
                    [],

                error:
                    serializeError(
                        error
                    ),

                step:
                    createStep(
                        "collect_source",
                        "failed",
                        startedAt,
                        {
                            message:
                                error?.message ||
                                ""
                        }
                    )
            });
        }
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

    const records =
        [];

    for (
        const result of
            successful
    ) {
        records.push(
            ...result.records
        );
    }

    return {
        success:
            failed.length ===
            0,

        results,

        records,

        summary: {
            totalSources:
                results.length,

            successfulSources:
                successful.length,

            failedSources:
                failed.length,

            recordsCollected:
                records.length
        }
    };
}

/* ============================================================
   دمج السجلات
============================================================ */

function mergeRecords(
    records
) {
    const merged =
        [];

    for (
        const group of
            safeArray(records)
    ) {
        if (
            Array.isArray(
                group
            )
        ) {
            merged.push(
                ...group
            );

            continue;
        }

        if (
            group !== null &&
            group !== undefined
        ) {
            merged.push(
                group
            );
        }
    }

    return merged;
}

/* ============================================================
   إزالة التكرار الأولية
============================================================ */

function deduplicate(
    records
) {
    const result =
        cleaner.deduplicateRecords(
            records
        );

    return {
        records:
            result.records,

        removed:
            result.duplicateCount
    };
}

/* ============================================================
   التنظيف
============================================================ */

function cleanRecords(
    records,
    options
) {
    return cleaner.runCleaningPipeline(
        records,
        {
            trimStrings:
                options.trimStrings ??
                true,

            removeEmptyRecords:
                options.removeEmptyRecords !==
                false,

            removeDuplicateRecords:
                options.removeDuplicates !==
                false,

            normalizeFieldNames:
                options.normalizeFieldNames !==
                false,

            normalizeWhitespace:
                options.normalizeWhitespace !==
                false,

            convertEmptyStringsToNull:
                options.convertEmptyStringsToNull ??
                false,

            normalizeNumbers:
                options.normalizeNumbers !==
                false,

            normalizeBooleans:
                options.normalizeBooleans ??
                false,

            removeEmptyFields:
                options.removeEmptyFields ??
                false,

            keepFields:
                options.keepFields,

            fieldOrder:
                options.fieldOrder
        }
    );
}

/* ============================================================
   التحقق من الجودة
============================================================ */

function validateRecords(
    records,
    options
) {
    return validator.validateDataset(
        records,
        {
            mode:
                options.validationMode ||
                "standard"
        }
    );
}

/* ============================================================
   تحليل خاص بالخصوصية
============================================================ */

function privacyCheck(
    records
) {
    const sensitiveValues =
        validator.scanSensitiveData(
            records
        );

    const sensitiveFields =
        validator.scanSensitiveFieldNames(
            records
        );

    const findings =
        [
            ...sensitiveValues,
            ...sensitiveFields
        ];

    return {
        status:
            findings.length === 0
                ? "no-obvious-findings"
                : "review-required",

        findingsCount:
            findings.length,

        findings
    };
}

/* ============================================================
   إنشاء خط معالجة مبدئي
============================================================ */

function createPipelineDefinition(
    options
) {
    const steps = [
        "collect",
        "merge"
    ];

    if (
        options.clean
    ) {
        steps.push(
            "clean"
        );
    }

    if (
        options.validate
    ) {
        steps.push(
            "validate"
        );
    }

    if (
        options.privacyScan
    ) {
        steps.push(
            "privacy_scan"
        );
    }

    steps.push(
        "readiness"
    );

    return steps;
}

/* ============================================================
   الجاهزية للتدريب
============================================================ */

function calculateReadiness(
    validationReport,
    privacyReport
) {
    const quality =
        numberOr(
            validationReport
                ?.quality
                ?.overall,
            0
        );

    const records =
        numberOr(
            validationReport
                ?.summary
                ?.records,
            0
        );

    const invalid =
        numberOr(
            validationReport
                ?.summary
                ?.invalidRecords,
            0
        );

    const duplicates =
        numberOr(
            validationReport
                ?.summary
                ?.duplicates,
            0
        );

    const privacyFindings =
        numberOr(
            privacyReport
                ?.findingsCount,
            0
        );

    const reasons = [];

    if (
        records === 0
    ) {
        reasons.push(
            "لا توجد سجلات."
        );
    }

    if (
        quality <
        70
    ) {
        reasons.push(
            "درجة الجودة أقل من الحد المبدئي."
        );
    }

    if (
        invalid > 0
    ) {
        reasons.push(
            "توجد سجلات غير صالحة."
        );
    }

    if (
        privacyFindings > 0
    ) {
        reasons.push(
            "توجد مؤشرات بيانات حساسة تحتاج إلى مراجعة."
        );
    }

    return {
        ready:
            reasons.length ===
            0,

        quality,

        records,

        invalidRecords:
            invalid,

        duplicates,

        privacyFindings,

        reasons
    };
}

/* ============================================================
   إنشاء بصمة Dataset
============================================================ */

function datasetChecksum(
    records
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            JSON.stringify(
                records
            )
        )
        .digest(
            "hex"
        );
}

/* ============================================================
   إنشاء وصف Dataset
============================================================ */

function createDataset(
    {
        name,
        type,
        records,
        sources,
        quality,
        privacy,
        readiness
    }
) {
    return {
        id:
            makeId(
                "dataset"
            ),

        name:
            String(
                name ||
                    "NOVA DATASET"
            )
                .trim(),

        type:
            String(
                type ||
                    "general"
            )
                .trim(),

        records:
            cloneValue(
                records
            ),

        recordCount:
            safeArray(
                records
            ).length,

        sources:
            cloneValue(
                sources
            ) || [],

        quality:
            cloneValue(
                quality
            ) || null,

        privacy:
            cloneValue(
                privacy
            ) || null,

        readiness:
            cloneValue(
                readiness
            ) || null,

        checksum:
            datasetChecksum(
                records
            ),

        status:
            readiness?.ready
                ? "ready_for_review"
                : "needs_review",

        createdAt:
            now(),

        updatedAt:
            now(),

        engine: {
            name:
                "NOVA DATA AI Processing Engine",

            version:
                CONFIG.VERSION
        }
    };
}

/* ============================================================
   تقرير مختصر
============================================================ */

function createSummary(
    {
        sourceCount,
        collected,
        beforeCleaning,
        afterCleaning,
        duplicatesRemoved,
        quality,
        privacy,
        readiness
    }
) {
    return {
        sources:
            sourceCount,

        collected:
            collected,

        recordsBeforeCleaning:
            beforeCleaning,

        recordsAfterCleaning:
            afterCleaning,

        duplicatesRemoved:
            duplicatesRemoved,

        quality:
            quality?.overall ??
            0,

        completeness:
            quality?.completeness ??
            0,

        uniqueness:
            quality?.uniqueness ??
            0,

        validity:
            quality?.validity ??
            0,

        format:
            quality?.format ??
            0,

        privacy:
            quality?.privacy ??
            0,

        sensitiveFindings:
            privacy?.findingsCount ??
            0,

        trainingReady:
            readiness?.ready ??
            false
    };
}

/* ============================================================
   معالجة Dataset موجود مسبقًا
============================================================ */

function processExistingDataset(
    records,
    options = {}
) {
    const normalized =
        normalizeOptions(
            options
        );

    const processId =
        makeId(
            "process"
        );

    const steps =
        [];

    const original =
        safeArray(
            records
        );

    let working =
        cloneValue(
            original
        );

    /*
     * Step 1
     * Remove duplicates before cleaning
     * إذا تم اختيار ذلك
     */
    if (
        normalized.removeDuplicates
    ) {
        const startedAt =
            now();

        const result =
            deduplicate(
                working
            );

        working =
            result.records;

        steps.push(
            createStep(
                "pre_deduplication",
                "completed",
                startedAt,
                {
                    before:
                        original.length,

                    after:
                        working.length,

                    removed:
                        result.removed
                }
            )
        );
    }

    /*
     * Step 2
     * Cleaning
     */
    let cleaningReport =
        null;

    if (
        normalized.clean
    ) {
        const startedAt =
            now();

        cleaningReport =
            cleanRecords(
                working,
                normalized
            );

        working =
            cleaningReport.records;

        steps.push(
            createStep(
                "clean",
                "completed",
                startedAt,
                {
                    before:
                        cleaningReport
                            .statistics
                            .originalRecords,

                    after:
                        cleaningReport
                            .statistics
                            .finalRecords
                }
            )
        );
    }

    /*
     * Step 3
     * Validation
     */
    let validationReport =
        null;

    if (
        normalized.validate
    ) {
        const startedAt =
            now();

        validationReport =
            validateRecords(
                working,
                normalized
            );

        steps.push(
            createStep(
                "validate",
                "completed",
                startedAt,
                {
                    quality:
                        validationReport
                            .quality
                            .overall,

                    invalid:
                        validationReport
                            .summary
                            .invalidRecords
                }
            )
        );
    }

    /*
     * Step 4
     * Privacy
     */
    let privacyReport =
        null;

    if (
        normalized.privacyScan
    ) {
        const startedAt =
            now();

        privacyReport =
            privacyCheck(
                working
            );

        steps.push(
            createStep(
                "privacy_scan",
                "completed",
                startedAt,
                {
                    findings:
                        privacyReport
                            .findingsCount
                }
            )
        );
    }

    /*
     * Step 5
     * Readiness
     */
    const readiness =
        calculateReadiness(
            validationReport,
            privacyReport
        );

    steps.push(
        createStep(
            "readiness",
            "completed",
            now(),
            {
                ready:
                    readiness.ready,

                quality:
                    readiness.quality
            }
        )
    );

    const summary =
        createSummary({
            sourceCount:
                normalized
                    .sourceCount ||
                0,

            collected:
                original.length,

            beforeCleaning:
                original.length,

            afterCleaning:
                working.length,

            duplicatesRemoved:
                Math.max(
                    0,
                    original.length -
                        working.length
                ),

            quality:
                validationReport
                    ?.quality,

            privacy:
                privacyReport,

            readiness
        });

    return {
        success:
            true,

        processId,

        records:
            working,

        summary,

        cleaning:
            cleaningReport,

        validation:
            validationReport,

        privacy:
            privacyReport,

        readiness,

        steps,

        checksum:
            datasetChecksum(
                working
            ),

        startedAt:
            now(),

        finishedAt:
            now()
    };
}

/* ============================================================
   معالجة كاملة للمصادر
============================================================ */

async function processSources(
    sources,
    options = {}
) {
    const normalized =
        normalizeOptions(
            options
        );

    const processId =
        makeId(
            "process"
        );

    const overallStartedAt =
        now();

    const pipeline =
        createPipelineDefinition(
            normalized
        );

    const steps =
        [];

    /*
     * =========================================
     * COLLECT
     * =========================================
     */
    let collection =
        {
            success:
                true,

            results:
                [],

            records:
                [],

            summary: {
                totalSources:
                    0,

                successfulSources:
                    0,

                failedSources:
                    0,

                recordsCollected:
                    0
            }
        };

    if (
        normalized.collect
    ) {
        const startedAt =
            now();

        collection =
            await collectSources(
                sources,
                normalized
            );

        steps.push(
            createStep(
                "collect",
                collection.failedSources ===
                    0
                    ? "completed"
                    : "completed_with_errors",
                startedAt,
                {
                    sources:
                        collection
                            .summary
                            .totalSources,

                    successful:
                        collection
                            .summary
                            .successfulSources,

                    failed:
                        collection
                            .summary
                            .failedSources,

                    records:
                        collection
                            .summary
                            .recordsCollected
                }
            )
        );
    }

    /*
     * =========================================
     * MERGE
     * =========================================
     */

    const mergeStartedAt =
        now();

    let working =
        cloneValue(
            collection.records
        );

    steps.push(
        createStep(
            "merge",
            "completed",
            mergeStartedAt,
            {
                records:
                    working.length
            }
        )
    );

    const beforeCleaning =
        working.length;

    /*
     * =========================================
     * CLEAN
     * =========================================
     */

    let cleaningReport =
        null;

    if (
        normalized.clean
    ) {
        const startedAt =
            now();

        cleaningReport =
            cleanRecords(
                working,
                normalized
            );

        working =
            cleaningReport.records;

        steps.push(
            createStep(
                "clean",
                "completed",
                startedAt,
                {
                    before:
                        beforeCleaning,

                    after:
                        working.length,

                    duplicatesRemoved:
                        cleaningReport
                            .statistics
                            .removedDuplicates,

                    emptyRemoved:
                        cleaningReport
                            .statistics
                            .removedEmpty
                }
            )
        );
    }

    /*
     * =========================================
     * VALIDATE
     * =========================================
     */

    let validationReport =
        null;

    if (
        normalized.validate
    ) {
        const startedAt =
            now();

        validationReport =
            validateRecords(
                working,
                normalized
            );

        steps.push(
            createStep(
                "validate",
                "completed",
                startedAt,
                {
                    quality:
                        validationReport
                            .quality
                            .overall,

                    status:
                        validationReport
                            .quality
                            .status,

                    invalid:
                        validationReport
                            .summary
                            .invalidRecords,

                    duplicates:
                        validationReport
                            .summary
                            .duplicates
                }
            )
        );
    }

    /*
     * =========================================
     * PRIVACY
     * =========================================
     */

    let privacyReport =
        null;

    if (
        normalized.privacyScan
    ) {
        const startedAt =
            now();

        privacyReport =
            privacyCheck(
                working
            );

        steps.push(
            createStep(
                "privacy_scan",
                "completed",
                startedAt,
                {
                    findings:
                        privacyReport
                            .findingsCount,

                    status:
                        privacyReport
                            .status
                }
            )
        );
    }

    /*
     * =========================================
     * READINESS
     * =========================================
     */

    const readinessStartedAt =
        now();

    const readiness =
        calculateReadiness(
            validationReport,
            privacyReport
        );

    steps.push(
        createStep(
            "readiness",
            "completed",
            readinessStartedAt,
            {
                ready:
                    readiness.ready,

                quality:
                    readiness.quality,

                reasons:
                    readiness.reasons
            }
        )
    );

    /*
     * =========================================
     * DATASET
     * =========================================
     */

    const dataset =
        createDataset({
            name:
                normalized.datasetName ||
                "NOVA DATA AI Dataset",

            type:
                normalized.datasetType ||
                "processed",

            records:
                working,

            sources:
                collection.results.map(
                    item => ({
                        type:
                            item
                                .source
                                ?.type ||
                            "unknown",

                        success:
                            item.success,

                        records:
                            item.records
                                ?.length ||
                            0,

                        source:
                            sanitizeSource(
                                item.source
                            )
                    })
                ),

            quality:
                validationReport
                    ?.quality ||

                null,

            privacy:
                privacyReport,

            readiness
        });

    const summary =
        createSummary({
            sourceCount:
                collection
                    .summary
                    .totalSources,

            collected:
                collection
                    .summary
                    .recordsCollected,

            beforeCleaning,

            afterCleaning:
                working.length,

            duplicatesRemoved:
                cleaningReport
                    ?.statistics
                    ?.removedDuplicates ||
                0,

            quality:
                validationReport
                    ?.quality,

            privacy:
                privacyReport,

            readiness
        });

    const overallFinishedAt =
        now();

    return {
        success:
            collection
                .summary
                .failedSources ===
            0,

        processId,

        engine: {
            name:
                "NOVA DATA AI Processing Engine",

            version:
                CONFIG.VERSION
        },

        pipeline,

        steps,

        collection,

        cleaning:
            cleaningReport,

        validation:
            validationReport,

        privacy:
            privacyReport,

        readiness,

        dataset,

        summary,

        startedAt:
            overallStartedAt,

        finishedAt:
            overallFinishedAt,

        checksum:
            dataset.checksum
    };
}

/* ============================================================
   تنظيف المصدر عند الحفظ
============================================================ */

function sanitizeSource(
    source
) {
    if (!source) {
        return null;
    }

    const output =
        {};

    for (
        const [
            key,
            value
        ] of Object.entries(
            source
        )
    ) {
        /*
         * لا نحفظ أي مفاتيح أو كلمات سر
         */
        const lower =
            String(
                key
            ).toLowerCase();

        if (
            lower.includes(
                "password"
            ) ||
            lower.includes(
                "secret"
            ) ||
            lower.includes(
                "token"
            ) ||
            lower.includes(
                "apikey"
            ) ||
            lower.includes(
                "api_key"
            )
        ) {
            continue;
        }

        if (
            typeof value ===
            "string"
        ) {
            output[key] =
                value.slice(
                    0,
                    4000
                );
        } else {
            output[key] =
                value;
        }
    }

    return output;
}

/* ============================================================
   تجهيز Batch
============================================================ */

function splitIntoBatches(
    records,
    batchSize =
        CONFIG.DEFAULT_BATCH_SIZE
) {
    const size =
        Math.max(
            1,
            Math.floor(
                numberOr(
                    batchSize,
                    CONFIG.DEFAULT_BATCH_SIZE
                )
            )
        );

    const batches =
        [];

    for (
        let index = 0;
        index < records.length;
        index += size
    ) {
        batches.push(
            records.slice(
                index,
                index + size
            )
        );
    }

    return batches;
}

/* ============================================================
   معالجة Batch واحد
============================================================ */

function processBatch(
    records,
    options = {}
) {
    return processExistingDataset(
        records,
        options
    );
}

/* ============================================================
   معالجة البيانات في Batches
============================================================ */

async function processInBatches(
    records,
    options = {}
) {
    const normalized =
        normalizeOptions(
            options
        );

    const batches =
        splitIntoBatches(
            safeArray(
                records
            ),
            normalized.batchSize ||
                CONFIG.DEFAULT_BATCH_SIZE
        );

    const output =
        [];

    const reports =
        [];

    for (
        let index = 0;
        index < batches.length;
        index++
    ) {
        const report =
            processBatch(
                batches[index],
                normalized
            );

        output.push(
            ...report.records
        );

        reports.push({
            batch:
                index + 1,

            recordsBefore:
                batches[index]
                    .length,

            recordsAfter:
                report.records
                    .length,

            quality:
                report
                    .validation
                    ?.quality
                    ?.overall ||
                0
        });
    }

    return {
        success:
            true,

        records:
            output,

        batchCount:
            batches.length,

        reports,

        checksum:
            datasetChecksum(
                output
            )
    };
}

/* ============================================================
   تحليل جودة قبل المعالجة
============================================================ */

function previewDataset(
    records
) {
    const safe =
        safeArray(
            records
        );

    const report =
        validator.validateDataset(
            safe
        );

    return {
        success:
            true,

        records:
            safe.length,

        quality:
            report.quality,

        summary:
            report.summary,

        privacy:
            report.privacy,

        recommendations:
            report.recommendations
    };
}

/* ============================================================
   مقارنة قبل وبعد
============================================================ */

function compareProcess(
    before,
    after
) {
    const beforeRecords =
        safeArray(
            before
        );

    const afterRecords =
        safeArray(
            after
        );

    const beforeValidation =
        validator.validateDataset(
            beforeRecords
        );

    const afterValidation =
        validator.validateDataset(
            afterRecords
        );

    return {
        before: {
            records:
                beforeRecords.length,

            quality:
                beforeValidation
                    .quality
        },

        after: {
            records:
                afterRecords.length,

            quality:
                afterValidation
                    .quality
        },

        difference: {
            recordCount:
                afterRecords.length -
                beforeRecords.length,

            quality:
                afterValidation
                    .quality
                    .overall -
                beforeValidation
                    .quality
                    .overall
        }
    };
}

/* ============================================================
   التأكد من إمكانية إنشاء Dataset
============================================================ */

function validateDatasetForStorage(
    dataset
) {
    if (
        !dataset ||
        typeof dataset !==
            "object"
    ) {
        throw new ProcessorError(
            "Dataset غير صالح.",
            "INVALID_DATASET"
        );
    }

    if (
        !Array.isArray(
            dataset.records
        )
    ) {
        throw new ProcessorError(
            "Dataset لا يحتوي سجلات صالحة.",
            "INVALID_DATASET_RECORDS"
        );
    }

    if (
        dataset.records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new ProcessorError(
            "Dataset أكبر من الحد المسموح.",
            "DATASET_TOO_LARGE"
        );
    }

    return true;
}

/* ============================================================
   إنشاء Manifest للبيانات
============================================================ */

function createManifest(
    dataset
) {
    validateDatasetForStorage(
        dataset
    );

    return {
        manifestVersion:
            "1.0",

        datasetId:
            dataset.id,

        datasetName:
            dataset.name,

        type:
            dataset.type,

        recordCount:
            dataset.recordCount,

        checksum:
            dataset.checksum,

        createdAt:
            dataset.createdAt,

        updatedAt:
            dataset.updatedAt,

        status:
            dataset.status,

        quality:
            dataset.quality,

        privacy:
            dataset.privacy,

        readiness:
            dataset.readiness,

        engine:
            dataset.engine
    };
}

/* ============================================================
   إنشاء تقرير نهائي
============================================================ */

function createFinalReport(
    result
) {
    return {
        reportId:
            makeId(
                "final_report"
            ),

        processId:
            result.processId,

        status:
            result.success
                ? "completed"
                : "completed_with_errors",

        summary:
            result.summary,

        pipeline:
            result.pipeline,

        steps:
            result.steps,

        readiness:
            result.readiness,

        checksum:
            result.checksum,

        generatedAt:
            now()
    };
}

/* ============================================================
   تسلسل الأخطاء
============================================================ */

function serializeError(
    error
) {
    if (
        error instanceof
        ProcessorError
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

    if (
        error?.code
    ) {
        return {
            name:
                error.name ||
                "Error",

            code:
                error.code,

            message:
                error.message ||
                "حدث خطأ.",

            details:
                error.details ||
                {}
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
   معلومات المحركات المرتبطة
============================================================ */

function getEngineDependencies() {
    return {
        processor: {
            name:
                "NOVA DATA AI Processing Engine",

            version:
                CONFIG.VERSION,

            status:
                "ready"
        },

        collector: {
            name:
                "NOVA DATA AI Collector",

            version:
                collector.version,

            status:
                "ready"
        },

        cleaner: {
            name:
                "NOVA DATA AI Cleaner",

            version:
                cleaner.version,

            status:
                "ready"
        },

        validator: {
            name:
                "NOVA DATA AI Validator",

            version:
                validator.version,

            status:
                "ready"
        },

        fileEngine: {
            name:
                "NOVA DATA AI File Engine",

            version:
                fileEngine.version,

            status:
                "ready"
        }
    };
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Processing Engine",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        capabilities: [
            "Multi-source collection",
            "URL processing",
            "Text processing",
            "JSON processing",
            "CSV processing",
            "File processing",
            "Record merging",
            "Duplicate removal",
            "Data cleaning",
            "Validation",
            "Quality scoring",
            "Privacy scanning",
            "Training readiness",
            "Batch processing",
            "Dataset checksums",
            "Processing manifests",
            "Final reports"
        ],

        dependencies:
            getEngineDependencies()
    };
}

/* ============================================================
   API الرئيسي
============================================================ */

const processor =
    Object.freeze({
        version:
            CONFIG.VERSION,

        config:
            CONFIG,

        ProcessorError,

        normalizeOptions,

        normalizeSource,

        collectURLSource,

        collectTextSource,

        collectJSONSource,

        collectCSVSource,

        collectFileSource,

        extractRecordsFromResult,

        collectSource,

        collectSources,

        mergeRecords,

        deduplicate,

        cleanRecords,

        validateRecords,

        privacyCheck,

        createPipelineDefinition,

        calculateReadiness,

        datasetChecksum,

        createDataset,

        createSummary,

        processExistingDataset,

        processSources,

        splitIntoBatches,

        processBatch,

        processInBatches,

        previewDataset,

        compareProcess,

        validateDatasetForStorage,

        createManifest,

        createFinalReport,

        sanitizeSource,

        serializeError,

        getEngineDependencies,

        getEngineInfo
    });

/* ============================================================
   التصدير
============================================================ */

module.exports =
    processor;

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
        "      NOVA DATA AI - PROCESSOR ENGINE"
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

    console.log("");
    console.log(
        "Connected engines:"
    );

    const dependencies =
        getEngineDependencies();

    console.log(
        `Collector: ${dependencies.collector.version}`
    );

    console.log(
        `Cleaner: ${dependencies.cleaner.version}`
    );

    console.log(
        `Validator: ${dependencies.validator.version}`
    );

    console.log(
        `File Engine: ${dependencies.fileEngine.version}`
    );

    console.log("");

    const testData = [
        {
            Name:
                "  NOVA AI  ",

            Age:
                "14",

            City:
                "Gaza"
        },

        {
            Name:
                "NOVA AI",

            Age:
                "14",

            City:
                "Gaza"
        },

        {
            Name:
                "",

            Age:
                "15",

            City:
                ""
        }
    ];

    try {
        const result =
            processExistingDataset(
                testData,
                {
                    clean:
                        true,

                    validate:
                        true,

                    privacyScan:
                        true,

                    removeDuplicates:
                        true,

                    removeEmptyRecords:
                        true,

                    normalizeFieldNames:
                        true,

                    normalizeWhitespace:
                        true,

                    normalizeNumbers:
                        true
                }
            );

        console.log(
            `Original records: ${testData.length}`
        );

        console.log(
            `Final records: ${result.records.length}`
        );

        console.log(
            `Quality: ${result.summary.quality}%`
        );

        console.log(
            `Training ready: ${result.readiness.ready}`
        );

        console.log(
            `Checksum: ${result.checksum}`
        );

        console.log("");

        console.log(
            "PROCESSOR TEST: SUCCESS"
        );
    } catch (
        error
    ) {
        console.error(
            "PROCESSOR TEST: FAILED"
        );

        console.error(
            serializeError(
                error
            )
        );

        process.exitCode = 1;
    }

    console.log(
        "================================================"
    );

    console.log("");
}
