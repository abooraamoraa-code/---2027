"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * REAL DATA CLEANING ENGINE
 * File: cleaner.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - تنظيف السجلات
 * - إزالة القيم الفارغة
 * - تنظيف المسافات
 * - توحيد أسماء الحقول
 * - إزالة التكرار
 * - معالجة النصوص
 * - اكتشاف السجلات المكررة
 * - توحيد القيم البسيطة
 * - إنشاء تقرير كامل عن عمليات التنظيف
 *
 * ملاحظة:
 * هذا المحرك لا يدّعي أن البيانات أصبحت مثالية.
 * هو ينفذ عمليات قابلة للقياس ويعرض ما تم تغييره.
 * ============================================================
 */

const crypto = require("crypto");

/* ============================================================
   الإعدادات
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_RECORDS: 250000,

    MAX_FIELD_NAME_LENGTH: 200,

    MAX_STRING_LENGTH: 100000,

    EMPTY_VALUES: [
        "",
        "null",
        "undefined",
        "n/a",
        "na",
        "none",
        "nil",
        "-"
    ],

    DEFAULT_OPTIONS: {
        trimStrings: true,
        removeEmptyRecords: true,
        removeDuplicateRecords: true,
        normalizeFieldNames: true,
        normalizeWhitespace: true,
        convertEmptyStringsToNull: false,
        normalizeNumbers: true,
        normalizeBooleans: false
    }
});

/* ============================================================
   أخطاء المحرك
============================================================ */

class CleanerError extends Error {
    constructor(
        message,
        code = "CLEANER_ERROR",
        details = {}
    ) {
        super(message);

        this.name = "CleanerError";
        this.code = code;
        this.details = details;
    }
}

/* ============================================================
   أدوات أساسية
============================================================ */

function makeId(prefix = "clean") {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date().toISOString();
}

function isPlainObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function isEmptyString(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return true;
    }

    if (
        typeof value !== "string"
    ) {
        return false;
    }

    const clean =
        value
            .trim()
            .toLowerCase();

    return CONFIG.EMPTY_VALUES.includes(
        clean
    );
}

function cleanString(
    value,
    maxLength = CONFIG.MAX_STRING_LENGTH
) {
    return String(value)
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, maxLength);
}

function normalizeWhitespace(value) {
    return String(value)
        .replace(/\s+/g, " ")
        .trim();
}

/* ============================================================
   تنظيف أسماء الحقول
============================================================ */

function normalizeFieldName(
    key
) {
    let name =
        cleanString(
            key,
            CONFIG.MAX_FIELD_NAME_LENGTH
        );

    name =
        name
            .normalize("NFKC")
            .replace(/\s+/g, "_")
            .replace(/[^\p{L}\p{N}_-]/gu, "_")
            .replace(/_+/g, "_")
            .replace(/^-+|-+$/g, "")
            .toLowerCase();

    if (!name) {
        name = "field";
    }

    if (/^\d/.test(name)) {
        name = `field_${name}`;
    }

    return name.slice(
        0,
        CONFIG.MAX_FIELD_NAME_LENGTH
    );
}

function createUniqueFieldName(
    base,
    used
) {
    if (!used.has(base)) {
        used.add(base);
        return base;
    }

    let counter = 2;

    while (
        used.has(`${base}_${counter}`)
    ) {
        counter++;
    }

    const result =
        `${base}_${counter}`;

    used.add(result);

    return result;
}

/* ============================================================
   التطبيع البسيط للقيم
============================================================ */

function normalizeNumber(
    value
) {
    if (
        typeof value === "number"
    ) {
        if (
            Number.isFinite(value)
        ) {
            return value;
        }

        return value;
    }

    if (
        typeof value !== "string"
    ) {
        return value;
    }

    const clean =
        value
            .trim()
            .replace(/,/g, "");

    if (!clean) {
        return value;
    }

    /*
     * أرقام صحيحة أو عشرية فقط.
     * لا نحول النصوص المختلطة إلى أرقام.
     */
    if (
        /^[-+]?\d+(?:\.\d+)?$/.test(
            clean
        )
    ) {
        const number =
            Number(clean);

        if (
            Number.isFinite(number)
        ) {
            return number;
        }
    }

    return value;
}

function normalizeBoolean(
    value
) {
    if (
        typeof value ===
        "boolean"
    ) {
        return value;
    }

    if (
        typeof value !==
        "string"
    ) {
        return value;
    }

    const clean =
        value
            .trim()
            .toLowerCase();

    if (
        ["true", "yes", "1", "on"]
            .includes(clean)
    ) {
        return true;
    }

    if (
        ["false", "no", "0", "off"]
            .includes(clean)
    ) {
        return false;
    }

    return value;
}

/* ============================================================
   التطبيع العام للقيمة
============================================================ */

function normalizeValue(
    value,
    options = {}
) {
    if (
        value === null ||
        value === undefined
    ) {
        return options
            .convertEmptyStringsToNull
            ? null
            : value;
    }

    if (
        typeof value === "string"
    ) {
        let result =
            value.normalize("NFKC");

        if (
            options.normalizeWhitespace
        ) {
            result =
                normalizeWhitespace(
                    result
                );
        }

        if (
            options.trimStrings
        ) {
            result =
                result.trim();
        }

        if (
            result === "" &&
            options.convertEmptyStringsToNull
        ) {
            return null;
        }

        if (
            options.normalizeNumbers
        ) {
            const number =
                normalizeNumber(
                    result
                );

            if (
                typeof number ===
                "number"
            ) {
                return number;
            }
        }

        if (
            options.normalizeBooleans
        ) {
            const boolean =
                normalizeBoolean(
                    result
                );

            if (
                typeof boolean ===
                "boolean"
            ) {
                return boolean;
            }
        }

        return result.slice(
            0,
            CONFIG.MAX_STRING_LENGTH
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            item =>
                normalizeValue(
                    item,
                    options
                )
        );
    }

    if (
        isPlainObject(value)
    ) {
        const result = {};

        for (
            const [
                key,
                child
            ] of Object.entries(
                value
            )
        ) {
            result[key] =
                normalizeValue(
                    child,
                    options
                );
        }

        return result;
    }

    return value;
}

/* ============================================================
   فحص إذا كان السجل فارغًا
============================================================ */

function isRecordEmpty(
    record
) {
    if (
        record === null ||
        record === undefined
    ) {
        return true;
    }

    if (
        typeof record === "string"
    ) {
        return isEmptyString(record);
    }

    if (
        Array.isArray(record)
    ) {
        if (
            record.length === 0
        ) {
            return true;
        }

        return record.every(
            value =>
                value === null ||
                value === undefined ||
                isEmptyString(value)
        );
    }

    if (
        isPlainObject(record)
    ) {
        const values =
            Object.values(
                record
            );

        if (
            values.length === 0
        ) {
            return true;
        }

        return values.every(
            value => {
                if (
                    value === null ||
                    value === undefined
                ) {
                    return true;
                }

                if (
                    typeof value ===
                    "string"
                ) {
                    return isEmptyString(
                        value
                    );
                }

                if (
                    Array.isArray(
                        value
                    )
                ) {
                    return (
                        value.length === 0
                    );
                }

                return false;
            }
        );
    }

    return false;
}

/* ============================================================
   تنظيف سجل منفرد
============================================================ */

function cleanRecord(
    record,
    options = {}
) {
    /*
     * النصوص تتحول إلى حقل text
     */
    if (
        typeof record ===
        "string"
    ) {
        const normalized =
            normalizeValue(
                record,
                options
            );

        if (
            options.removeEmptyRecords &&
            isEmptyString(
                normalized
            )
        ) {
            return {
                record: null,
                changed: true,
                removed: true,
                reasons: [
                    "empty_record"
                ]
            };
        }

        return {
            record: {
                text:
                    normalized
            },
            changed:
                normalized !==
                record,

            removed: false,

            reasons:
                normalized !==
                record
                    ? [
                          "text_normalized"
                      ]
                    : []
        };
    }

    /*
     * القيم البسيطة
     */
    if (
        !isPlainObject(record)
    ) {
        const normalized =
            normalizeValue(
                record,
                options
            );

        return {
            record: {
                value:
                    normalized
            },
            changed:
                normalized !==
                record,

            removed: false,

            reasons: []
        };
    }

    /*
     * الكائنات
     */
    const output = {};

    const usedNames =
        new Set();

    let changed = false;

    const reasons =
        new Set();

    for (
        const [
            originalKey,
            originalValue
        ] of Object.entries(
            record
        )
    ) {
        let key =
            originalKey;

        if (
            options.normalizeFieldNames
        ) {
            const base =
                normalizeFieldName(
                    originalKey
                );

            key =
                createUniqueFieldName(
                    base,
                    usedNames
                );

            if (
                key !==
                originalKey
            ) {
                changed = true;

                reasons.add(
                    "field_names_normalized"
                );
            }
        } else {
            key =
                createUniqueFieldName(
                    String(key),
                    usedNames
                );
        }

        const before =
            originalValue;

        const after =
            normalizeValue(
                originalValue,
                options
            );

        if (
            JSON.stringify(
                before
            ) !==
            JSON.stringify(
                after
            )
        ) {
            changed = true;

            reasons.add(
                "values_normalized"
            );
        }

        /*
         * حذف القيم الفارغة
         */
        if (
            isEmptyString(
                after
            )
        ) {
            if (
                options
                    .convertEmptyStringsToNull
            ) {
                output[key] = null;

                if (
                    after !== null
                ) {
                    changed = true;

                    reasons.add(
                        "empty_values_normalized"
                    );
                }
            } else {
                output[key] = "";

                if (
                    after !==
                    originalValue
                ) {
                    changed = true;
                }
            }

            continue;
        }

        output[key] = after;
    }

    /*
     * فحص السجل بعد التنظيف
     */
    if (
        options.removeEmptyRecords &&
        isRecordEmpty(output)
    ) {
        return {
            record: null,
            changed: true,
            removed: true,
            reasons: [
                ...reasons,
                "empty_record"
            ]
        };
    }

    return {
        record: output,
        changed,
        removed: false,
        reasons: [
            ...reasons
        ]
    };
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

/* ============================================================
   إزالة التكرار
============================================================ */

function deduplicateRecords(
    records
) {
    const seen =
        new Map();

    const unique = [];

    const duplicateIndexes =
        [];

    for (
        let index = 0;
        index < records.length;
        index++
    ) {
        const record =
            records[index];

        const fingerprint =
            crypto
                .createHash("sha256")
                .update(
                    stableSerialize(
                        record
                    )
                )
                .digest("hex");

        if (
            seen.has(
                fingerprint
            )
        ) {
            duplicateIndexes.push(
                {
                    index:
                        index + 1,

                    duplicateOf:
                        seen.get(
                            fingerprint
                        ) + 1
                }
            );

            continue;
        }

        seen.set(
            fingerprint,
            index
        );

        unique.push(
            record
        );
    }

    return {
        records:
            unique,

        duplicateCount:
            duplicateIndexes.length,

        duplicateIndexes
    };
}

/* ============================================================
   حساب إحصائيات الحقول
============================================================ */

function getFieldStatistics(
    records
) {
    const fields =
        new Map();

    for (
        const record of
            records
    ) {
        if (
            !isPlainObject(
                record
            )
        ) {
            continue;
        }

        for (
            const [
                key,
                value
            ] of Object.entries(
                record
            )
        ) {
            if (
                !fields.has(key)
            ) {
                fields.set(
                    key,
                    {
                        name: key,
                        occurrences: 0,
                        missing: 0,
                        empty: 0,
                        typeCounts: {}
                    }
                );
            }

            const stat =
                fields.get(key);

            stat.occurrences++;

            if (
                value === null ||
                value === undefined
            ) {
                stat.missing++;

                continue;
            }

            if (
                typeof value ===
                    "string" &&
                value.trim() === ""
            ) {
                stat.empty++;
            }

            const type =
                Array.isArray(value)
                    ? "array"
                    : typeof value;

            stat.typeCounts[type] =
                (
                    stat.typeCounts[type] ||
                    0
                ) + 1;
        }
    }

    return [...fields.values()];
}

/* ============================================================
   تنظيف جميع البيانات
============================================================ */

function cleanDataset(
    records,
    options = {}
) {
    if (
        !Array.isArray(records)
    ) {
        throw new CleanerError(
            "records يجب أن تكون مصفوفة.",
            "INVALID_RECORDS"
        );
    }

    if (
        records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new CleanerError(
            `عدد السجلات يتجاوز الحد ${CONFIG.MAX_RECORDS}.`,
            "TOO_MANY_RECORDS"
        );
    }

    const finalOptions = {
        ...CONFIG.DEFAULT_OPTIONS,
        ...(options || {})
    };

    const startedAt =
        now();

    const beforeCount =
        records.length;

    const cleaned =
        [];

    const removedRecords =
        [];

    const changes =
        [];

    for (
        let index = 0;
        index <
        records.length;
        index++
    ) {
        const original =
            records[index];

        const result =
            cleanRecord(
                original,
                finalOptions
            );

        if (
            result.removed
        ) {
            removedRecords.push(
                {
                    index:
                        index + 1,

                    reasons:
                        result.reasons
                }
            );

            continue;
        }

        cleaned.push(
            result.record
        );

        if (
            result.changed
        ) {
            changes.push(
                {
                    index:
                        index + 1,

                    reasons:
                        result.reasons
                }
            );
        }
    }

    const beforeDedup =
        cleaned.length;

    let finalRecords =
        cleaned;

    let duplicateInfo = {
        records:
            cleaned,

        duplicateCount:
            0,

        duplicateIndexes:
            []
    };

    if (
        finalOptions
            .removeDuplicateRecords
    ) {
        duplicateInfo =
            deduplicateRecords(
                cleaned
            );

        finalRecords =
            duplicateInfo.records;
    }

    const afterCount =
        finalRecords.length;

    const duplicateCount =
        duplicateInfo.duplicateCount;

    const removedEmptyCount =
        removedRecords.length;

    const valuesChanged =
        changes.length;

    const fieldStatistics =
        getFieldStatistics(
            finalRecords
        );

    /*
     * نسبة الاحتفاظ
     */
    const retentionRate =
        beforeCount === 0
            ? 0
            : Math.round(
                  (afterCount /
                      beforeCount) *
                      100
              );

    /*
     * نسبة السجلات التي تغيرت
     */
    const changeRate =
        beforeCount === 0
            ? 0
            : Math.round(
                  (valuesChanged /
                      beforeCount) *
                      100
              );

    const finishedAt =
        now();

    return {
        success: true,

        engine: {
            name:
                "NOVA DATA AI Cleaner",

            version:
                CONFIG.VERSION
        },

        records:
            finalRecords,

        statistics: {
            before:
                beforeCount,

            after:
                afterCount,

            removedEmpty:
                removedEmptyCount,

            removedDuplicates:
                duplicateCount,

            changedRecords:
                valuesChanged,

            retentionRate,

            changeRate
        },

        fields:
            fieldStatistics,

        details: {
            removedRecords,

            duplicates:
                duplicateInfo
                    .duplicateIndexes,

            changed:
                changes
        },

        options:
            finalOptions,

        startedAt,

        finishedAt,

        operationId:
            makeId("clean_operation")
    };
}

/* ============================================================
   إزالة الحقول الفارغة بالكامل
============================================================ */

function removeEmptyFields(
    records
) {
    if (
        !Array.isArray(records)
    ) {
        return [];
    }

    return records.map(
        record => {
            if (
                !isPlainObject(
                    record
                )
            ) {
                return record;
            }

            const output = {};

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    record
                )
            ) {
                if (
                    value === null ||
                    value === undefined
                ) {
                    continue;
                }

                if (
                    typeof value ===
                        "string" &&
                    value.trim() === ""
                ) {
                    continue;
                }

                output[key] =
                    value;
            }

            return output;
        }
    );
}

/* ============================================================
   إزالة الحقول غير المطلوبة
============================================================ */

function keepFields(
    records,
    fields
) {
    if (
        !Array.isArray(records)
    ) {
        return [];
    }

    if (
        !Array.isArray(fields) ||
        fields.length === 0
    ) {
        return records;
    }

    const allowed =
        new Set(
            fields.map(
                field =>
                    String(field)
            )
        );

    return records.map(
        record => {
            if (
                !isPlainObject(
                    record
                )
            ) {
                return record;
            }

            const output = {};

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    record
                )
            ) {
                if (
                    allowed.has(
                        key
                    )
                ) {
                    output[key] =
                        value;
                }
            }

            return output;
        }
    );
}

/* ============================================================
   إعادة ترتيب الحقول
============================================================ */

function reorderFields(
    records,
    preferredOrder = []
) {
    if (
        !Array.isArray(records)
    ) {
        return [];
    }

    const order =
        Array.isArray(
            preferredOrder
        )
            ? preferredOrder.map(
                  String
              )
            : [];

    return records.map(
        record => {
            if (
                !isPlainObject(
                    record
                )
            ) {
                return record;
            }

            const output = {};

            for (
                const field of
                    order
            ) {
                if (
                    Object.prototype.hasOwnProperty.call(
                        record,
                        field
                    )
                ) {
                    output[field] =
                        record[field];
                }
            }

            for (
                const [
                    key,
                    value
                ] of Object.entries(
                    record
                )
            ) {
                if (
                    !Object.prototype.hasOwnProperty.call(
                        output,
                        key
                    )
                ) {
                    output[key] =
                        value;
                }
            }

            return output;
        }
    );
}

/* ============================================================
   إنشاء fingerprint للسجل
============================================================ */

function recordFingerprint(
    record
) {
    return crypto
        .createHash("sha256")
        .update(
            stableSerialize(
                record
            )
        )
        .digest("hex");
}

/* ============================================================
   مقارنة Dataset قبل وبعد
============================================================ */

function compareDatasets(
    before,
    after
) {
    const beforeArray =
        Array.isArray(
            before
        )
            ? before
            : [];

    const afterArray =
        Array.isArray(
            after
        )
            ? after
            : [];

    const beforeSet =
        new Set(
            beforeArray.map(
                recordFingerprint
            )
        );

    const afterSet =
        new Set(
            afterArray.map(
                recordFingerprint
            )
        );

    let removed = 0;
    let added = 0;

    for (
        const fingerprint of
            beforeSet
    ) {
        if (
            !afterSet.has(
                fingerprint
            )
        ) {
            removed++;
        }
    }

    for (
        const fingerprint of
            afterSet
    ) {
        if (
            !beforeSet.has(
                fingerprint
            )
        ) {
            added++;
        }
    }

    return {
        before:
            beforeArray.length,

        after:
            afterArray.length,

        removed,

        added
    };
}

/* ============================================================
   تشغيل Pipeline كامل
============================================================ */

function runCleaningPipeline(
    records,
    options = {}
) {
    let working =
        Array.isArray(
            records
        )
            ? records
            : [];

    const pipeline =
        [];

    /*
     * المرحلة الأولى
     */
    if (
        options.removeEmptyFields
    ) {
        const before =
            working;

        working =
            removeEmptyFields(
                working
            );

        pipeline.push({
            step:
                "remove_empty_fields",

            beforeCount:
                before.length,

            afterCount:
                working.length
        });
    }

    /*
     * المرحلة الثانية:
     * keepFields
     */
    if (
        Array.isArray(
            options.keepFields
        ) &&
        options.keepFields.length
    ) {
        const before =
            working;

        working =
            keepFields(
                working,
                options.keepFields
            );

        pipeline.push({
            step:
                "keep_fields",

            beforeCount:
                before.length,

            afterCount:
                working.length
        });
    }

    /*
     * المرحلة الثالثة:
     * تنظيف رئيسي
     */
    const cleaned =
        cleanDataset(
            working,
            options
        );

    working =
        cleaned.records;

    pipeline.push({
        step:
            "clean_dataset",

        beforeCount:
            cleaned
                .statistics
                .before,

        afterCount:
            cleaned
                .statistics
                .after,

        removedEmpty:
            cleaned
                .statistics
                .removedEmpty,

        removedDuplicates:
            cleaned
                .statistics
                .removedDuplicates
    });

    /*
     * المرحلة الرابعة:
     * إعادة ترتيب الحقول
     */
    if (
        Array.isArray(
            options.fieldOrder
        ) &&
        options.fieldOrder.length
    ) {
        const before =
            working;

        working =
            reorderFields(
                working,
                options.fieldOrder
            );

        pipeline.push({
            step:
                "reorder_fields",

            beforeCount:
                before.length,

            afterCount:
                working.length
        });
    }

    return {
        success: true,

        records:
            working,

        pipeline,

        statistics:
            {
                originalRecords:
                    Array.isArray(
                        records
                    )
                        ? records.length
                        : 0,

                finalRecords:
                    working.length
            },

        comparison:
            compareDatasets(
                records,
                working
            ),

        operationId:
            makeId(
                "pipeline"
            ),

        startedAt:
            now()
    };
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Cleaner",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        capabilities: [
            "String normalization",
            "Whitespace normalization",
            "Field name normalization",
            "Empty record removal",
            "Empty field removal",
            "Duplicate detection",
            "Duplicate removal",
            "Number normalization",
            "Boolean normalization",
            "Field filtering",
            "Field ordering",
            "Cleaning reports",
            "Pipeline processing",
            "Dataset comparison"
        ],

        limits: {
            maxRecords:
                CONFIG.MAX_RECORDS,

            maxStringLength:
                CONFIG.MAX_STRING_LENGTH,

            maxFieldNameLength:
                CONFIG.MAX_FIELD_NAME_LENGTH
        }
    };
}

/* ============================================================
   API المحرك
============================================================ */

const cleaner = Object.freeze({
    version:
        CONFIG.VERSION,

    config:
        CONFIG,

    CleanerError,

    cleanString,

    normalizeWhitespace,

    normalizeFieldName,

    normalizeValue,

    normalizeNumber,

    normalizeBoolean,

    isRecordEmpty,

    cleanRecord,

    deduplicateRecords,

    recordFingerprint,

    getFieldStatistics,

    cleanDataset,

    removeEmptyFields,

    keepFields,

    reorderFields,

    compareDatasets,

    runCleaningPipeline,

    getEngineInfo,

    stableSerialize
});

/* ============================================================
   التصدير
============================================================ */

module.exports =
    cleaner;

/* ============================================================
   اختبار تشغيل مباشر
============================================================ */

if (
    require.main === module
) {
    console.log("");
    console.log(
        "=============================================="
    );
    console.log(
        "      NOVA DATA AI - CLEANER ENGINE"
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

    const testData = [
        {
            Name:
                "  NOVA AI  ",
            Age:
                "14",
            Email:
                "test@example.com"
        },

        {
            Name:
                "NOVA AI",
            Age:
                "14",
            Email:
                "test@example.com"
        },

        {
            Name:
                "   "
        }
    ];

    try {
        const result =
            cleanDataset(
                testData
            );

        console.log(
            "Test completed."
        );

        console.log(
            `Before: ${result.statistics.before}`
        );

        console.log(
            `After: ${result.statistics.after}`
        );

        console.log(
            `Duplicates removed: ${result.statistics.removedDuplicates}`
        );

        console.log(
            `Empty records removed: ${result.statistics.removedEmpty}`
        );
    } catch (error) {
        console.error(
            error.message
        );
    }

    console.log(
        "=============================================="
    );
    console.log("");
}
