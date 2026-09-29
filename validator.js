"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * VALIDATION + QUALITY + PRIVACY ENGINE
 * File: validator.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - التحقق من بنية البيانات
 * - اكتشاف الحقول المفقودة
 * - اكتشاف القيم الفارغة
 * - اكتشاف اختلاف أنواع البيانات
 * - كشف التكرار
 * - فحص مؤشرات البيانات الحساسة
 * - حساب مؤشرات جودة قابلة للقياس
 * - إنشاء تقرير كامل
 *
 * ملاحظة:
 * هذا المحرك لا يضمن أن البيانات خالية من الأخطاء.
 * هو يكتشف المشكلات التي يستطيع التعرف عليها ويعرض النتائج.
 * ============================================================
 */

const crypto = require("crypto");

/* ============================================================
   الإعدادات
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_RECORDS: 250000,

    MAX_FINDINGS: 10000,

    MIN_VALID_QUALITY: 70,

    STRICT_QUALITY_THRESHOLD: 90,

    SENSITIVE_PATTERNS: Object.freeze({
        email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,

        phone:
            /(?:\+?\d[\d\s().-]{7,}\d)/,

        password:
            /\b(?:password|passwd|pwd)\s*[:=]\s*[^\s]+/i,

        api_key:
            /\b(?:api[_ -]?key|apikey)\s*[:=]\s*[A-Za-z0-9_\-]{8,}/i,

        bearer_token:
            /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/i,

        secret:
            /\b(?:secret|client_secret)\s*[:=]\s*[^\s]+/i,

        private_key:
            /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/
    })
});

/* ============================================================
   خطأ المحرك
============================================================ */

class ValidatorError extends Error {
    constructor(
        message,
        code = "VALIDATOR_ERROR",
        details = {}
    ) {
        super(message);

        this.name = "ValidatorError";
        this.code = code;
        this.details = details;
    }
}

/* ============================================================
   أدوات أساسية
============================================================ */

function makeId(prefix = "validation") {
    return `${prefix}_${crypto.randomUUID()}`;
}

function now() {
    return new Date().toISOString();
}

function isObject(value) {
    return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)
    );
}

function isEmpty(value) {
    if (
        value === null ||
        value === undefined
    ) {
        return true;
    }

    if (
        typeof value === "string"
    ) {
        return value.trim() === "";
    }

    if (
        Array.isArray(value)
    ) {
        return value.length === 0;
    }

    return false;
}

function stableSerialize(value) {
    if (
        value === null ||
        typeof value !== "object"
    ) {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value
            .map(stableSerialize)
            .join(",")}]`;
    }

    return `{${Object.keys(value)
        .sort()
        .map(
            key =>
                `${JSON.stringify(key)}:${stableSerialize(
                    value[key]
                )}`
        )
        .join(",")}}`;
}

function fingerprint(value) {
    return crypto
        .createHash("sha256")
        .update(
            stableSerialize(value)
        )
        .digest("hex");
}

/* ============================================================
   التحقق من الإدخال الأساسي
============================================================ */

function validateInput(records) {
    if (!Array.isArray(records)) {
        throw new ValidatorError(
            "records يجب أن تكون مصفوفة.",
            "INVALID_RECORDS"
        );
    }

    if (
        records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new ValidatorError(
            `عدد السجلات أكبر من الحد ${CONFIG.MAX_RECORDS}.`,
            "TOO_MANY_RECORDS"
        );
    }

    return true;
}

/* ============================================================
   اكتشاف تكرار السجلات
============================================================ */

function detectDuplicates(records) {
    const seen = new Map();
    const duplicates = [];

    for (
        let index = 0;
        index < records.length;
        index++
    ) {
        const hash =
            fingerprint(
                records[index]
            );

        if (seen.has(hash)) {
            duplicates.push({
                index:
                    index + 1,

                duplicateOf:
                    seen.get(hash) + 1,

                fingerprint:
                    hash
            });

            continue;
        }

        seen.set(
            hash,
            index
        );
    }

    return {
        count:
            duplicates.length,

        findings:
            duplicates
    };
}

/* ============================================================
   تحليل الحقول
============================================================ */

function inspectFields(records) {
    const fields = new Map();

    for (
        let recordIndex = 0;
        recordIndex < records.length;
        recordIndex++
    ) {
        const record =
            records[recordIndex];

        if (!isObject(record)) {
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
            if (!fields.has(key)) {
                fields.set(
                    key,
                    {
                        name: key,
                        present: 0,
                        missing: 0,
                        empty: 0,
                        types: {},
                        examples: []
                    }
                );
            }

            const field =
                fields.get(key);

            field.present++;

            if (isEmpty(value)) {
                field.empty++;
            }

            const type =
                Array.isArray(value)
                    ? "array"
                    : value === null
                    ? "null"
                    : typeof value;

            field.types[type] =
                (
                    field.types[type] ||
                    0
                ) + 1;

            if (
                field.examples.length < 3 &&
                !isEmpty(value)
            ) {
                field.examples.push(
                    typeof value ===
                        "string"
                        ? value.slice(0, 100)
                        : value
                );
            }
        }
    }

    /*
     * نحدد كل الحقول التي ظهرت مرة واحدة على الأقل.
     */
    const totalRecords =
        records.length;

    const result =
        [...fields.values()].map(
            field => {
                field.missing =
                    totalRecords -
                    field.present;

                field.completeness =
                    totalRecords === 0
                        ? 0
                        : Math.round(
                              (field.present /
                                  totalRecords) *
                                  100
                          );

                field.nonEmpty =
                    field.present -
                    field.empty;

                return field;
            }
        );

    return result;
}

/* ============================================================
   اكتشاف السجلات ذات البنية غير المتوافقة
============================================================ */

function inspectRecordStructures(
    records
) {
    let objectCount = 0;
    let primitiveCount = 0;
    let arrayCount = 0;
    let nullCount = 0;

    const structures = new Map();

    for (const record of records) {
        let structure;

        if (record === null) {
            nullCount++;
            structure = "null";
        } else if (Array.isArray(record)) {
            arrayCount++;
            structure = "array";
        } else if (
            typeof record === "object"
        ) {
            objectCount++;

            const keys =
                Object.keys(record).sort();

            structure =
                `object:${keys.join("|")}`;
        } else {
            primitiveCount++;
            structure =
                typeof record;
        }

        structures.set(
            structure,
            (
                structures.get(
                    structure
                ) || 0
            ) + 1
        );
    }

    const structureGroups =
        [...structures.entries()]
            .map(
                ([
                    structure,
                    count
                ]) => ({
                    structure,
                    count
                })
            )
            .sort(
                (a, b) =>
                    b.count - a.count
            );

    return {
        objectCount,
        primitiveCount,
        arrayCount,
        nullCount,
        structureGroups,
        mixed:
            structureGroups.length > 1
    };
}

/* ============================================================
   فحص القيم
============================================================ */

function inspectValues(records) {
    const findings = [];

    for (
        let recordIndex = 0;
        recordIndex < records.length;
        recordIndex++
    ) {
        const record =
            records[recordIndex];

        if (!isObject(record)) {
            if (
                record === null ||
                record === undefined ||
                (
                    typeof record === "string" &&
                    record.trim() === ""
                )
            ) {
                findings.push({
                    type:
                        "empty_record",

                    record:
                        recordIndex + 1,

                    field:
                        null,

                    message:
                        "السجل فارغ."
                });
            }

            continue;
        }

        for (
            const [
                field,
                value
            ] of Object.entries(
                record
            )
        ) {
            if (isEmpty(value)) {
                findings.push({
                    type:
                        "empty_value",

                    record:
                        recordIndex + 1,

                    field,

                    message:
                        "القيمة فارغة."
                });
            }

            if (
                typeof value ===
                    "number" &&
                !Number.isFinite(
                    value
                )
            ) {
                findings.push({
                    type:
                        "invalid_number",

                    record:
                        recordIndex + 1,

                    field,

                    message:
                        "الرقم غير صالح."
                });
            }
        }

        if (
            findings.length >=
            CONFIG.MAX_FINDINGS
        ) {
            break;
        }
    }

    return findings;
}

/* ============================================================
   فحص أنواع البيانات
============================================================ */

function inspectTypeConsistency(
    records
) {
    const fields =
        new Map();

    for (const record of records) {
        if (!isObject(record)) {
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
            const type =
                Array.isArray(value)
                    ? "array"
                    : value === null
                    ? "null"
                    : typeof value;

            if (!fields.has(key)) {
                fields.set(
                    key,
                    new Set()
                );
            }

            fields.get(key).add(
                type
            );
        }
    }

    const mixedFields = [];

    for (
        const [
            field,
            types
        ] of fields.entries()
    ) {
        if (types.size > 1) {
            mixedFields.push({
                field,
                types: [...types]
            });
        }
    }

    return {
        mixedFieldCount:
            mixedFields.length,

        mixedFields
    };
}

/* ============================================================
   فحص البريد والأرقام الحساسة
============================================================ */

function scanSensitiveData(
    records
) {
    const findings = [];

    for (
        let recordIndex = 0;
        recordIndex < records.length;
        recordIndex++
    ) {
        const record =
            records[recordIndex];

        let serialized;

        try {
            serialized =
                JSON.stringify(
                    record
                );
        } catch {
            continue;
        }

        for (
            const [
                type,
                pattern
            ] of Object.entries(
                CONFIG.SENSITIVE_PATTERNS
            )
        ) {
            /*
             * reset lastIndex لسلامة Regex
             */
            pattern.lastIndex = 0;

            if (
                pattern.test(
                    serialized
                )
            ) {
                findings.push({
                    record:
                        recordIndex + 1,

                    type,

                    message:
                        getSensitiveMessage(
                            type
                        )
                });

                if (
                    findings.length >=
                    CONFIG.MAX_FINDINGS
                ) {
                    return findings;
                }
            }
        }
    }

    return findings;
}

function getSensitiveMessage(
    type
) {
    const messages = {
        email:
            "تم العثور على نمط يشبه بريدًا إلكترونيًا.",

        phone:
            "تم العثور على نمط يشبه رقم هاتف.",

        password:
            "تم العثور على نمط يشبه كلمة مرور.",

        api_key:
            "تم العثور على نمط يشبه مفتاح API.",

        bearer_token:
            "تم العثور على نمط يشبه Bearer Token.",

        secret:
            "تم العثور على نمط يشبه قيمة سرية.",

        private_key:
            "تم العثور على نمط يشبه مفتاح خاص."
    };

    return (
        messages[type] ||
        "تم العثور على مؤشر بيانات حساسة."
    );
}

/* ============================================================
   فحص أسماء الحقول الحساسة
============================================================ */

function scanSensitiveFieldNames(
    records
) {
    const sensitiveNames = [
        "password",
        "passwd",
        "pwd",
        "token",
        "secret",
        "api_key",
        "apikey",
        "private_key",
        "access_token",
        "refresh_token",
        "credit_card",
        "card_number",
        "cvv",
        "ssn"
    ];

    const normalized =
        new Set(
            sensitiveNames
        );

    const findings = [];

    const seen =
        new Set();

    for (const record of records) {
        if (!isObject(record)) {
            continue;
        }

        for (
            const field of Object.keys(
                record
            )
        ) {
            const key =
                String(field)
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, "_");

            if (
                normalized.has(key) &&
                !seen.has(key)
            ) {
                seen.add(key);

                findings.push({
                    field,
                    type:
                        "sensitive_field_name",

                    message:
                        `اسم الحقل "${field}" قد يشير إلى بيانات حساسة.`
                });
            }
        }
    }

    return findings;
}

/* ============================================================
   كشف الروابط والبريد داخل النص
============================================================ */

function inspectTextPatterns(
    records
) {
    const urlPattern =
        /\bhttps?:\/\/[^\s<>"']+/gi;

    const emailPattern =
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

    let urls = 0;
    let emails = 0;

    for (const record of records) {
        let text = "";

        try {
            text =
                JSON.stringify(
                    record
                );
        } catch {
            continue;
        }

        const foundUrls =
            text.match(
                urlPattern
            );

        const foundEmails =
            text.match(
                emailPattern
            );

        urls +=
            foundUrls
                ? foundUrls.length
                : 0;

        emails +=
            foundEmails
                ? foundEmails.length
                : 0;
    }

    return {
        urlCount:
            urls,

        emailCount:
            emails
    };
}

/* ============================================================
   فحص السجلات غير الصالحة
============================================================ */

function inspectValidity(
    records
) {
    const invalid = [];

    for (
        let index = 0;
        index < records.length;
        index++
    ) {
        const record =
            records[index];

        if (
            record === null ||
            record === undefined
        ) {
            invalid.push({
                record:
                    index + 1,

                reason:
                    "null_or_undefined"
            });

            continue;
        }

        if (
            typeof record ===
                "string" &&
            record.trim() === ""
        ) {
            invalid.push({
                record:
                    index + 1,

                reason:
                    "empty_string"
            });

            continue;
        }

        if (
            typeof record ===
                "number" &&
            !Number.isFinite(
                record
            )
        ) {
            invalid.push({
                record:
                    index + 1,

                reason:
                    "invalid_number"
            });

            continue;
        }

        if (
            isObject(record) &&
            Object.keys(record).length === 0
        ) {
            invalid.push({
                record:
                    index + 1,

                reason:
                    "empty_object"
            });
        }
    }

    return invalid;
}

/* ============================================================
   حساب الاكتمال
============================================================ */

function calculateCompleteness(
    records,
    fieldStats
) {
    if (
        records.length === 0 ||
        fieldStats.length === 0
    ) {
        return 0;
    }

    let totalExpected = 0;
    let present = 0;

    for (const field of fieldStats) {
        totalExpected +=
            records.length;

        present +=
            field.present;
    }

    if (
        totalExpected === 0
    ) {
        return 0;
    }

    return Math.round(
        (present /
            totalExpected) *
            100
    );
}

/* ============================================================
   حساب الاكتمال مع تجاهل الفراغ
============================================================ */

function calculateEffectiveCompleteness(
    records,
    fieldStats
) {
    if (
        records.length === 0 ||
        fieldStats.length === 0
    ) {
        return 0;
    }

    let expected =
        records.length *
        fieldStats.length;

    let filled = 0;

    for (const field of fieldStats) {
        filled +=
            field.present -
            field.empty;
    }

    if (expected === 0) {
        return 0;
    }

    return Math.round(
        (filled /
            expected) *
            100
    );
}

/* ============================================================
   حساب التفرد
============================================================ */

function calculateUniqueness(
    records
) {
    if (
        records.length === 0
    ) {
        return 0;
    }

    const set =
        new Set(
            records.map(
                fingerprint
            )
        );

    return Math.round(
        (set.size /
            records.length) *
            100
    );
}

/* ============================================================
   حساب صلاحية السجلات
============================================================ */

function calculateValidityScore(
    records,
    invalidRecords
) {
    if (
        records.length === 0
    ) {
        return 0;
    }

    return Math.round(
        ((records.length -
            invalidRecords.length) /
            records.length) *
            100
    );
}

/* ============================================================
   حساب تنوع الأنواع
============================================================ */

function calculateFormatScore(
    records,
    structureInfo,
    typeInfo
) {
    if (
        records.length === 0
    ) {
        return 0;
    }

    let score = 100;

    /*
     * تنوع بنية السجلات
     */
    if (
        structureInfo.mixed
    ) {
        score -= 15;
    }

    /*
     * اختلاف أنواع الحقول
     */
    score -= Math.min(
        30,
        typeInfo.mixedFieldCount *
            3
    );

    /*
     * سجلات غير كائنية
     */
    if (
        structureInfo.primitiveCount >
            0 &&
        structureInfo.objectCount >
            0
    ) {
        score -= 10;
    }

    return Math.max(
        0,
        Math.min(
            100,
            score
        )
    );
}

/* ============================================================
   حساب جودة الخصوصية
============================================================ */

function calculatePrivacyScore(
    sensitiveFindings,
    sensitiveFieldFindings
) {
    const total =
        sensitiveFindings.length +
        sensitiveFieldFindings.length;

    if (total === 0) {
        return 100;
    }

    /*
     * نحن لا نعيد توزيع النتيجة على
     * أنها حكم قانوني، بل مؤشر مراجعة.
     */
    return Math.max(
        0,
        100 -
            Math.min(
                100,
                total * 10
            )
    );
}

/* ============================================================
   درجة الجودة الإجمالية
============================================================ */

function calculateOverallQuality({
    completeness,
    uniqueness,
    validity,
    format,
    privacy
}) {
    return Math.round(
        completeness * 0.25 +
        uniqueness * 0.20 +
        validity * 0.20 +
        format * 0.20 +
        privacy * 0.15
    );
}

/* ============================================================
   حالة الجودة
============================================================ */

function qualityStatus(
    score
) {
    if (
        score >=
        CONFIG.STRICT_QUALITY_THRESHOLD
    ) {
        return "excellent";
    }

    if (
        score >= 80
    ) {
        return "good";
    }

    if (
        score >= CONFIG.MIN_VALID_QUALITY
    ) {
        return "review";
    }

    return "low";
}

function privacyStatus(
    sensitiveCount
) {
    if (
        sensitiveCount === 0
    ) {
        return "no-obvious-findings";
    }

    return "review-required";
}

/* ============================================================
   إنشاء التوصيات
============================================================ */

function createRecommendations({
    recordsCount,
    duplicateCount,
    emptyFindings,
    mixedFieldCount,
    sensitiveCount,
    completeness,
    uniqueness,
    validity,
    format
}) {
    const recommendations =
        [];

    if (
        recordsCount === 0
    ) {
        recommendations.push(
            "أضف سجلات قبل محاولة تجهيز Dataset."
        );
    }

    if (
        duplicateCount > 0
    ) {
        recommendations.push(
            `يوجد ${duplicateCount} سجل مكرر؛ يفضل إزالة التكرار.`
        );
    }

    if (
        emptyFindings > 0
    ) {
        recommendations.push(
            `يوجد ${emptyFindings} مؤشر على قيم أو سجلات فارغة.`
        );
    }

    if (
        mixedFieldCount > 0
    ) {
        recommendations.push(
            "بعض الحقول تحتوي أنواع بيانات مختلفة؛ راجعها قبل التدريب."
        );
    }

    if (
        sensitiveCount > 0
    ) {
        recommendations.push(
            "يجب مراجعة البيانات الحساسة قبل المشاركة أو النشر."
        );
    }

    if (
        completeness < 80
    ) {
        recommendations.push(
            "اكتمال البيانات منخفض نسبيًا؛ راجع الحقول الناقصة."
        );
    }

    if (
        uniqueness < 90
    ) {
        recommendations.push(
            "التفرد أقل من المستوى المرتفع؛ راجع التكرارات."
        );
    }

    if (
        validity < 90
    ) {
        recommendations.push(
            "توجد سجلات تحتاج إلى تحقق إضافي."
        );
    }

    if (
        format < 90
    ) {
        recommendations.push(
            "تنسيق السجلات يحتاج إلى توحيد إضافي."
        );
    }

    if (
        recommendations.length === 0
    ) {
        recommendations.push(
            "لم يتم اكتشاف مشكلة رئيسية بواسطة قواعد الفحص الحالية؛ ما زالت المراجعة البشرية مفيدة."
        );
    }

    return recommendations;
}

/* ============================================================
   الفحص الرئيسي
============================================================ */

function validateDataset(
    records,
    options = {}
) {
    validateInput(
        records
    );

    const startedAt =
        now();

    const safeRecords =
        records;

    /*
     * Duplicate analysis
     */
    const duplicateInfo =
        detectDuplicates(
            safeRecords
        );

    /*
     * Field analysis
     */
    const fieldStats =
        inspectFields(
            safeRecords
        );

    /*
     * Record structures
     */
    const structureInfo =
        inspectRecordStructures(
            safeRecords
        );

    /*
     * Empty / invalid values
     */
    const valueFindings =
        inspectValues(
            safeRecords
        );

    /*
     * Mixed types
     */
    const typeInfo =
        inspectTypeConsistency(
            safeRecords
        );

    /*
     * Sensitive values
     */
    const sensitiveFindings =
        scanSensitiveData(
            safeRecords
        );

    /*
     * Sensitive field names
     */
    const sensitiveFieldFindings =
        scanSensitiveFieldNames(
            safeRecords
        );

    /*
     * Text pattern counts
     */
    const textPatterns =
        inspectTextPatterns(
            safeRecords
        );

    /*
     * Invalid records
     */
    const invalidRecords =
        inspectValidity(
            safeRecords
        );

    /*
     * Quality metrics
     */
    const completeness =
        calculateEffectiveCompleteness(
            safeRecords,
            fieldStats
        );

    const uniqueness =
        calculateUniqueness(
            safeRecords
        );

    const validity =
        calculateValidityScore(
            safeRecords,
            invalidRecords
        );

    const format =
        calculateFormatScore(
            safeRecords,
            structureInfo,
            typeInfo
        );

    const privacy =
        calculatePrivacyScore(
            sensitiveFindings,
            sensitiveFieldFindings
        );

    const quality =
        calculateOverallQuality({
            completeness,
            uniqueness,
            validity,
            format,
            privacy
        });

    const totalSensitive =
        sensitiveFindings.length +
        sensitiveFieldFindings.length;

    const status =
        qualityStatus(
            quality
        );

    const recommendations =
        createRecommendations({
            recordsCount:
                safeRecords.length,

            duplicateCount:
                duplicateInfo.count,

            emptyFindings:
                valueFindings.length,

            mixedFieldCount:
                typeInfo.mixedFieldCount,

            sensitiveCount:
                totalSensitive,

            completeness,
            uniqueness,
            validity,
            format
        });

    const finishedAt =
        now();

    return {
        success: true,

        validationId:
            makeId("validation"),

        engine: {
            name:
                "NOVA DATA AI Validator",

            version:
                CONFIG.VERSION
        },

        summary: {
            records:
                safeRecords.length,

            validRecords:
                safeRecords.length -
                invalidRecords.length,

            invalidRecords:
                invalidRecords.length,

            duplicates:
                duplicateInfo.count,

            emptyFindings:
                valueFindings.length,

            mixedFields:
                typeInfo.mixedFieldCount,

            sensitiveFindings:
                totalSensitive
        },

        quality: {
            overall:
                quality,

            status,

            completeness,

            uniqueness,

            validity,

            format,

            privacy
        },

        privacy: {
            status:
                privacyStatus(
                    totalSensitive
                ),

            findingsCount:
                totalSensitive,

            valueFindings:
                sensitiveFindings,

            fieldFindings:
                sensitiveFieldFindings
        },

        validation: {
            invalidRecords,

            emptyValues:
                valueFindings,

            duplicates:
                duplicateInfo.findings,

            mixedTypes:
                typeInfo.mixedFields,

            structure:
                structureInfo
        },

        fields:
            fieldStats,

        patterns:
            textPatterns,

        recommendations,

        options,

        startedAt,

        finishedAt
    };
}

/* ============================================================
   التحقق الصارم
============================================================ */

function strictValidate(
    records
) {
    return validateDataset(
        records,
        {
            mode:
                "strict"
        }
    );
}

/* ============================================================
   فحص سريع
============================================================ */

function quickValidate(
    records
) {
    validateInput(
        records
    );

    const duplicates =
        detectDuplicates(
            records
        );

    const invalid =
        inspectValidity(
            records
        );

    const sensitive =
        scanSensitiveData(
            records
        );

    return {
        success: true,

        records:
            records.length,

        duplicates:
            duplicates.count,

        invalid:
            invalid.length,

        sensitive:
            sensitive.length
    };
}

/* ============================================================
   إنشاء ملخص قابل للعرض
============================================================ */

function createQualitySummary(
    report
) {
    if (
        !report ||
        !report.quality
    ) {
        throw new ValidatorError(
            "تقرير الجودة غير صالح.",
            "INVALID_REPORT"
        );
    }

    return {
        score:
            report.quality.overall,

        status:
            report.quality.status,

        completeness:
            report.quality.completeness,

        uniqueness:
            report.quality.uniqueness,

        validity:
            report.quality.validity,

        format:
            report.quality.format,

        privacy:
            report.quality.privacy,

        records:
            report.summary?.records ||
            0,

        duplicates:
            report.summary?.duplicates ||
            0,

        invalidRecords:
            report.summary?.invalidRecords ||
            0,

        sensitiveFindings:
            report.summary?.sensitiveFindings ||
            0
    };
}

/* ============================================================
   تحديد إمكانية الانتقال لمرحلة التدريب
============================================================ */

function trainingReadiness(
    report
) {
    if (
        !report ||
        !report.quality
    ) {
        return {
            ready: false,
            reasons: [
                "تقرير الجودة غير موجود."
            ]
        };
    }

    const reasons = [];

    const score =
        report.quality.overall;

    const privacy =
        report.privacy?.findingsCount ||
        0;

    const invalid =
        report.summary?.invalidRecords ||
        0;

    const records =
        report.summary?.records ||
        0;

    if (
        records === 0
    ) {
        reasons.push(
            "لا توجد سجلات."
        );
    }

    if (
        score < CONFIG.MIN_VALID_QUALITY
    ) {
        reasons.push(
            `درجة الجودة أقل من ${CONFIG.MIN_VALID_QUALITY}.`
        );
    }

    if (
        privacy > 0
    ) {
        reasons.push(
            "توجد مؤشرات بيانات حساسة تحتاج إلى مراجعة."
        );
    }

    if (
        invalid > 0
    ) {
        reasons.push(
            "توجد سجلات غير صالحة تحتاج إلى معالجة."
        );
    }

    return {
        ready:
            reasons.length === 0,

        score,

        reasons,

        checks: {
            records:
                records > 0,

            quality:
                score >=
                CONFIG.MIN_VALID_QUALITY,

            privacy:
                privacy === 0,

            validity:
                invalid === 0
        }
    };
}

/* ============================================================
   إنشاء Checksum للمجموعة
============================================================ */

function datasetChecksum(
    records
) {
    const serialized =
        stableSerialize(
            records
        );

    return crypto
        .createHash("sha256")
        .update(
            serialized
        )
        .digest("hex");
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Validator",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        capabilities: [
            "Record validation",
            "Field analysis",
            "Completeness scoring",
            "Uniqueness scoring",
            "Validity scoring",
            "Format consistency",
            "Sensitive data detection",
            "Sensitive field detection",
            "Duplicate detection",
            "Quality scoring",
            "Training readiness",
            "Dataset checksum",
            "Quality recommendations"
        ],

        thresholds: {
            review:
                CONFIG.MIN_VALID_QUALITY,

            excellent:
                CONFIG.STRICT_QUALITY_THRESHOLD
        }
    };
}

/* ============================================================
   API
============================================================ */

const validator = Object.freeze({
    version:
        CONFIG.VERSION,

    config:
        CONFIG,

    ValidatorError,

    validateInput,

    detectDuplicates,

    inspectFields,

    inspectRecordStructures,

    inspectValues,

    inspectTypeConsistency,

    scanSensitiveData,

    scanSensitiveFieldNames,

    inspectTextPatterns,

    inspectValidity,

    calculateCompleteness,

    calculateEffectiveCompleteness,

    calculateUniqueness,

    calculateValidityScore,

    calculateFormatScore,

    calculatePrivacyScore,

    calculateOverallQuality,

    qualityStatus,

    privacyStatus,

    createRecommendations,

    validateDataset,

    strictValidate,

    quickValidate,

    createQualitySummary,

    trainingReadiness,

    datasetChecksum,

    stableSerialize,

    fingerprint,

    getEngineInfo
});

/* ============================================================
   التصدير
============================================================ */

module.exports =
    validator;

/* ============================================================
   اختبار مباشر
============================================================ */

if (
    require.main === module
) {
    console.log("");
    console.log(
        "=============================================="
    );

    console.log(
        "     NOVA DATA AI - VALIDATOR ENGINE"
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
            name:
                "NOVA AI",

            age:
                14,

            email:
                "test@example.com"
        },

        {
            name:
                "NOVA AI",

            age:
                14,

            email:
                "test@example.com"
        },

        {
            name:
                "",

            age:
                "unknown"
        },

        {
            password:
                "example-secret"
        }
    ];

    try {
        const report =
            validateDataset(
                testData
            );

        console.log(
            `Records: ${report.summary.records}`
        );

        console.log(
            `Duplicates: ${report.summary.duplicates}`
        );

        console.log(
            `Sensitive findings: ${report.summary.sensitiveFindings}`
        );

        console.log(
            `Quality: ${report.quality.overall}%`
        );

        console.log(
            `Status: ${report.quality.status}`
        );

        const readiness =
            trainingReadiness(
                report
            );

        console.log(
            `Training ready: ${readiness.ready}`
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
