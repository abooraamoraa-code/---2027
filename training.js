"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * AI TRAINING DATA PREPARATION ENGINE
 * File: training.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - تجهيز Dataset لمراحل تدريب الذكاء الاصطناعي
 * - إنشاء train / validation / test
 * - تحويل البيانات إلى صيغ تدريب مختلفة
 * - دعم:
 *      text
 *      instruction
 *      classification
 *      chat
 *      seq2seq
 *      generic
 * - إزالة التكرار
 * - استبعاد السجلات غير الصالحة
 * - إنشاء Manifest
 * - حساب الإحصائيات
 * - إنشاء JSONL جاهز للخطوط التدريبية
 *
 * ملاحظة مهمة:
 * هذا الملف "يجهز البيانات".
 * لا يقوم بتدريب نموذج AI بنفسه.
 * التدريب الفعلي يحتاج نموذجًا وبيئة تدريب مناسبة.
 *
 * لا يحتاج API Key.
 * ============================================================
 */

const crypto = require("crypto");

/* ============================================================
   الإعدادات
============================================================ */

const CONFIG = Object.freeze({
    VERSION: "1.0.0",

    MAX_RECORDS:
        250000,

    DEFAULT_SPLIT: Object.freeze({
        train: 0.8,
        validation: 0.1,
        test: 0.1
    }),

    MIN_SPLIT_SIZE:
        1,

    DEFAULT_MODE:
        "generic",

    SUPPORTED_MODES: [
        "generic",
        "text",
        "instruction",
        "classification",
        "chat",
        "seq2seq"
    ],

    MAX_TEXT_LENGTH:
        200000,

    SHUFFLE_DEFAULT:
        true,

    SEED_DEFAULT:
        42
});

/* ============================================================
   خطأ المحرك
============================================================ */

class TrainingError extends Error {
    constructor(
        message,
        code = "TRAINING_ERROR",
        details = {}
    ) {
        super(message);

        this.name =
            "TrainingError";

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
    prefix = "training"
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

function safeString(
    value,
    max =
        CONFIG.MAX_TEXT_LENGTH
) {
    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }

    return String(
        value
    )
        .replace(
            /\u0000/g,
            ""
        )
        .trim()
        .slice(
            0,
            max
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

function clone(
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

/* ============================================================
   Serializing
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

function fingerprint(
    value
) {
    return crypto
        .createHash(
            "sha256"
        )
        .update(
            stableSerialize(
                value
            )
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
        throw new TrainingError(
            "records يجب أن تكون مصفوفة.",
            "INVALID_RECORDS"
        );
    }

    if (
        records.length >
        CONFIG.MAX_RECORDS
    ) {
        throw new TrainingError(
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
        isObject(record)
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
                    value === null ||
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
                        value.trim()
                            .length ===
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
   إزالة التكرار
============================================================ */

function deduplicateRecords(
    records
) {
    const seen =
        new Set();

    const unique =
        [];

    let duplicates =
        0;

    for (
        const record of
            records
    ) {
        const hash =
            fingerprint(
                record
            );

        if (
            seen.has(hash)
        ) {
            duplicates++;
            continue;
        }

        seen.add(
            hash
        );

        unique.push(
            record
        );
    }

    return {
        records:
            unique,

        duplicates
    };
}

/* ============================================================
   Seeded Random
============================================================ */

function createSeededRandom(
    seed
) {
    let state =
        Math.abs(
            Number(seed)
        ) || 1;

    return function random() {
        state =
            (
                state *
                    1664525 +
                1013904223
            ) %
            4294967296;

        return (
            state /
            4294967296
        );
    };
}

/* ============================================================
   Shuffle
============================================================ */

function shuffleRecords(
    records,
    seed =
        CONFIG.SEED_DEFAULT
) {
    const output =
        records.slice();

    const random =
        createSeededRandom(
            seed
        );

    for (
        let i =
            output.length - 1;
        i > 0;
        i--
    ) {
        const j =
            Math.floor(
                random() *
                    (i + 1)
            );

        const temp =
            output[i];

        output[i] =
            output[j];

        output[j] =
            temp;
    }

    return output;
}

/* ============================================================
   Split
============================================================ */

function normalizeSplits(
    split = {}
) {
    let train =
        Number(
            split.train ??
                CONFIG.DEFAULT_SPLIT
                    .train
        );

    let validation =
        Number(
            split.validation ??
                split.val ??
                CONFIG.DEFAULT_SPLIT
                    .validation
        );

    let test =
        Number(
            split.test ??
                CONFIG.DEFAULT_SPLIT
                    .test
        );

    if (
        !Number.isFinite(train) ||
        !Number.isFinite(validation) ||
        !Number.isFinite(test)
    ) {
        throw new TrainingError(
            "قيم تقسيم Dataset غير صالحة.",
            "INVALID_SPLIT"
        );
    }

    if (
        train < 0 ||
        validation < 0 ||
        test < 0
    ) {
        throw new TrainingError(
            "نسب التقسيم لا يمكن أن تكون سالبة.",
            "NEGATIVE_SPLIT"
        );
    }

    const total =
        train +
        validation +
        test;

    if (
        total <= 0
    ) {
        throw new TrainingError(
            "مجموع نسب التقسيم يجب أن يكون أكبر من صفر.",
            "ZERO_SPLIT"
        );
    }

    /*
     * إذا لم تساوِ 1 بالضبط،
     * نطبعها تلقائيًا.
     */
    train /=
        total;

    validation /=
        total;

    test /=
        total;

    return {
        train,
        validation,
        test
    };
}

function calculateSplitCounts(
    total,
    split
) {
    if (
        total <= 0
    ) {
        return {
            train: 0,
            validation: 0,
            test: 0
        };
    }

    let train = Math.floor(
        total * split.train
    );

    let validation = Math.floor(
        total * split.validation
    );

    let test =
        total -
        train -
        validation;

    /*
     * إذا كانت هناك نسبة test
     * يجب ألا تصبح سالبة.
     */
    if (
        test < 0
    ) {
        test = 0;
    }

    /*
     * معالجة المجموع الصغير
     */
    while (
        train +
            validation +
            test <
        total
    ) {
        train++;
    }

    return {
        train,
        validation,
        test
    };
}

function splitDataset(
    records,
    split = CONFIG.DEFAULT_SPLIT,
    options = {}
) {
    validateRecords(
        records
    );

    const normalized =
        normalizeSplits(
            split
        );

    let working =
        records.slice();

    if (
        options.shuffle !== false
    ) {
        working =
            shuffleRecords(
                working,
                options.seed ??
                    CONFIG.SEED_DEFAULT
            );
    }

    const counts =
        calculateSplitCounts(
            working.length,
            normalized
        );

    const train =
        working.slice(
            0,
            counts.train
        );

    const validation =
        working.slice(
            counts.train,
            counts.train +
                counts.validation
        );

    const test =
        working.slice(
            counts.train +
                counts.validation
        );

    return {
        train,
        validation,
        test,

        counts: {
            train:
                train.length,

            validation:
                validation.length,

            test:
                test.length,

            total:
                working.length
        },

        ratios:
            normalized
    };
}

/* ============================================================
   استخراج النص من سجل
============================================================ */

function extractText(
    record,
    fields = []
) {
    if (
        typeof record ===
        "string"
    ) {
        return safeString(
            record
        );
    }

    if (
        Array.isArray(
            record
        )
    ) {
        return record
            .map(
                value =>
                    safeString(
                        value
                    )
            )
            .filter(Boolean)
            .join(" ");
    }

    if (
        isObject(record)
    ) {
        if (
            Array.isArray(
                fields
            ) &&
            fields.length
        ) {
            return fields
                .map(
                    field =>
                        safeString(
                            record[
                                field
                            ]
                        )
                )
                .filter(Boolean)
                .join(" ");
        }

        const preferred =
            [
                "text",
                "content",
                "body",
                "prompt",
                "input",
                "question",
                "output",
                "answer"
            ];

        for (
            const field of
                preferred
        ) {
            if (
                record[field] !==
                    undefined &&
                record[field] !==
                    null
            ) {
                const text =
                    safeString(
                        record[field]
                    );

                if (text) {
                    return text;
                }
            }
        }

        return Object.values(
            record
        )
            .map(
                value =>
                    safeString(
                        value
                    )
            )
            .filter(Boolean)
            .join(" ");
    }

    return safeString(
        record
    );
}

/* ============================================================
   Generic
============================================================ */

function toGenericRecord(
    record,
    index
) {
    if (
        isObject(record)
    ) {
        return {
            ...clone(record),
            _nova_index:
                index + 1
        };
    }

    return {
        text:
            extractText(
                record
            ),

        _nova_index:
            index + 1
    };
}

/* ============================================================
   Text
============================================================ */

function toTextRecord(
    record
) {
    const text =
        extractText(
            record
        );

    return {
        text
    };
}

/* ============================================================
   Instruction
 *
 * الناتج:
 * {
 *   instruction,
 *   input,
 *   output
 * }
 * ============================================================
 */

function toInstructionRecord(
    record,
    options = {}
) {
    const instructionField =
        options.instructionField ||
        "instruction";

    const inputField =
        options.inputField ||
        "input";

    const outputField =
        options.outputField ||
        "output";

    if (
        isObject(record)
    ) {
        const instruction =
            safeString(
                record[
                    instructionField
                ] ??
                record.prompt ??
                record.question ??
                record.instruction
            );

        const input =
            safeString(
                record[
                    inputField
                ] ??
                record.context ??
                record.input
            );

        const output =
            safeString(
                record[
                    outputField
                ] ??
                record.answer ??
                record.response ??
                record.output
            );

        return {
            instruction,
            input,
            output
        };
    }

    return {
        instruction:
            extractText(
                record
            ),

        input:
            "",

        output:
            ""
    };
}

/* ============================================================
   Classification
 * الناتج:
 * {
 *   text,
 *   label
 * }
 * ============================================================
 */

function toClassificationRecord(
    record,
    options = {}
) {
    const textField =
        options.textField ||
        "text";

    const labelField =
        options.labelField ||
        "label";

    if (
        isObject(record)
    ) {
        return {
            text:
                safeString(
                    record[
                        textField
                    ] ??
                    record.content ??
                    record.input ??
                    record.text
                ),

            label:
                record[
                    labelField
                ] ??
                record.category ??
                record.class ??
                ""
        };
    }

    return {
        text:
            extractText(
                record
            ),

        label:
            ""
    };
}

/* ============================================================
   Chat
 * الناتج:
 * {
 *   messages: [
 *      { role, content },
 *      ...
 *   ]
 * }
 * ============================================================
 */

function normalizeChatRole(
    role
) {
    const value =
        safeString(
            role,
            50
        )
            .toLowerCase();

    const aliases = {
        user:
            "user",

        human:
            "user",

        المستخدم:
            "user",

        assistant:
            "assistant",

        bot:
            "assistant",

        model:
            "assistant",

        المساعد:
            "assistant",

        system:
            "system",

        النظام:
            "system"
    };

    return (
        aliases[value] ||
        "user"
    );
}

function toChatRecord(
    record,
    options = {}
) {
    if (
        isObject(record) &&
        Array.isArray(
            record.messages
        )
    ) {
        return {
            messages:
                record.messages
                    .map(
                        message => ({
                            role:
                                normalizeChatRole(
                                    message?.role
                                ),

                            content:
                                safeString(
                                    message?.content ??
                                    message?.text ??
                                    ""
                                )
                        })
                    )
                    .filter(
                        message =>
                            message.content
                                .length >
                            0
                    )
        };
    }

    if (
        isObject(record)
    ) {
        const userField =
            options.userField ||
            "user";

        const assistantField =
            options.assistantField ||
            "assistant";

        const systemField =
            options.systemField ||
            "system";

        const messages =
            [];

        const systemText =
            safeString(
                record[
                    systemField
                ]
            );

        const userText =
            safeString(
                record[
                    userField
                ] ??
                record.question ??
                record.input ??
                record.prompt
            );

        const assistantText =
            safeString(
                record[
                    assistantField
                ] ??
                record.answer ??
                record.output ??
                record.response
            );

        if (systemText) {
            messages.push({
                role:
                    "system",

                content:
                    systemText
            });
        }

        if (userText) {
            messages.push({
                role:
                    "user",

                content:
                    userText
            });
        }

        if (assistantText) {
            messages.push({
                role:
                    "assistant",

                content:
                    assistantText
            });
        }

        return {
            messages
        };
    }

    return {
        messages: [
            {
                role:
                    "user",

                content:
                    extractText(
                        record
                    )
            }
        ]
    };
}

/* ============================================================
   Seq2Seq
 * input -> target
 * ============================================================
 */

function toSeq2SeqRecord(
    record,
    options = {}
) {
    const inputField =
        options.inputField ||
        "input";

    const targetField =
        options.targetField ||
        "target";

    if (
        isObject(record)
    ) {
        return {
            input:
                safeString(
                    record[
                        inputField
                    ] ??
                    record.source ??
                    record.text ??
                    record.input
                ),

            target:
                safeString(
                    record[
                        targetField
                    ] ??
                    record.output ??
                    record.answer ??
                    record.target
                )
        };
    }

    return {
        input:
            extractText(
                record
            ),

        target:
            ""
    };
}

/* ============================================================
   تحويل حسب Mode
============================================================ */

function convertRecord(
    record,
    index,
    mode,
    options
) {
    switch (
        String(
            mode
        )
            .toLowerCase()
    ) {
        case "generic":
            return toGenericRecord(
                record,
                index
            );

        case "text":
            return toTextRecord(
                record
            );

        case "instruction":
            return toInstructionRecord(
                record,
                options
            );

        case "classification":
            return toClassificationRecord(
                record,
                options
            );

        case "chat":
            return toChatRecord(
                record,
                options
            );

        case "seq2seq":
            return toSeq2SeqRecord(
                record,
                options
            );

        default:
            throw new TrainingError(
                `وضع التدريب غير مدعوم: ${mode}`,
                "UNSUPPORTED_MODE"
            );
    }
}

/* ============================================================
   إزالة التكرار بعد التحويل
============================================================ */

function deduplicateTrainingRecords(
    records
) {
    return deduplicateRecords(
        records
    );
}

/* ============================================================
   فحص صلاحية Record
============================================================ */

function isTrainingRecordUsable(
    record,
    mode
) {
    if (
        isEmptyRecord(
            record
        )
    ) {
        return false;
    }

    const normalizedMode =
        String(
            mode
        )
            .toLowerCase();

    if (
        normalizedMode ===
        "instruction"
    ) {
        const instruction =
            safeString(
                record.instruction
            );

        const output =
            safeString(
                record.output
            );

        return (
            instruction.length >
            0 &&
            output.length >
            0
        );
    }

    if (
        normalizedMode ===
        "classification"
    ) {
        const text =
            safeString(
                record.text
            );

        const label =
            record.label;

        return (
            text.length >
                0 &&
            label !==
                null &&
            label !==
                undefined &&
            safeString(
                label
            ).length >
                0
        );
    }

    if (
        normalizedMode ===
        "chat"
    ) {
        return (
            Array.isArray(
                record.messages
            ) &&
            record.messages.some(
                message =>
                    safeString(
                        message?.content
                    ).length >
                    0
            )
        );
    }

    if (
        normalizedMode ===
        "seq2seq"
    ) {
        return (
            safeString(
                record.input
            ).length >
                0 &&
            safeString(
                record.target
            ).length >
                0
        );
    }

    if (
        normalizedMode ===
        "text"
    ) {
        return (
            safeString(
                record.text
            ).length >
            0
        );
    }

    return true;
}

/* ============================================================
   تحويل Dataset بالكامل
============================================================ */

function transformRecords(
    records,
    mode,
    options = {}
) {
    const output =
        [];

    const rejected =
        [];

    for (
        let index = 0;
        index < records.length;
        index++
    ) {
        const original =
            records[index];

        try {
            const converted =
                convertRecord(
                    original,
                    index,
                    mode,
                    options
                );

            if (
                !isTrainingRecordUsable(
                    converted,
                    mode
                )
            ) {
                rejected.push({
                    index:
                        index + 1,

                    reason:
                        "record_not_training_ready"
                });

                continue;
            }

            output.push(
                converted
            );
        } catch (
            error
        ) {
            rejected.push({
                index:
                    index + 1,

                reason:
                    error.message
            });
        }
    }

    return {
        records:
            output,

        rejected,

        rejectedCount:
            rejected.length
    };
}

/* ============================================================
   حساب Token Estimate بسيط
 *
 * هذا ليس Tokenizer فعليًا.
 * هو تقدير فقط بناءً على طول النص.
 * ============================================================
 */

function estimateTextLength(
    value
) {
    return safeString(
        value
    ).length;
}

function collectTextFromTrainingRecord(
    record
) {
    if (
        typeof record ===
        "string"
    ) {
        return record;
    }

    if (
        !isObject(record)
    ) {
        return String(
            record ?? ""
        );
    }

    if (
        Array.isArray(
            record.messages
        )
    ) {
        return record.messages
            .map(
                message =>
                    safeString(
                        message?.content
                    )
            )
            .join(" ");
    }

    return Object.values(
        record
    )
        .map(
            value =>
                safeString(
                    value
                )
        )
        .join(" ");
}

function estimateDatasetText(
    records
) {
    let characters = 0;

    for (
        const record of
            records
    ) {
        characters +=
            estimateTextLength(
                collectTextFromTrainingRecord(
                    record
                )
            );
    }

    /*
     * تقريبي فقط.
     * المتوسط يختلف حسب Tokenizer.
     */
    const estimatedTokens =
        Math.ceil(
            characters /
                4
        );

    return {
        characters,

        estimatedTokens
    };
}

/* ============================================================
   توزيع التصنيفات
============================================================ */

function analyzeLabels(
    records
) {
    const labels =
        new Map();

    for (
        const record of
            records
    ) {
        if (
            !isObject(record)
        ) {
            continue;
        }

        if (
            record.label ===
            undefined ||
            record.label ===
            null
        ) {
            continue;
        }

        const label =
            safeString(
                record.label,
                500
            );

        if (!label) {
            continue;
        }

        labels.set(
            label,
            (
                labels.get(
                    label
                ) || 0
            ) + 1
        );
    }

    return [...labels.entries()]
        .map(
            ([
                label,
                count
            ]) => ({
                label,
                count
            })
        )
        .sort(
            (a, b) =>
                b.count -
                a.count
        );
}

/* ============================================================
   تحليل Chat
============================================================ */

function analyzeChat(
    records
) {
    let totalMessages =
        0;

    const roles =
        {};

    for (
        const record of
            records
    ) {
        if (
            !Array.isArray(
                record?.messages
            )
        ) {
            continue;
        }

        for (
            const message of
                record.messages
        ) {
            totalMessages++;

            const role =
                normalizeChatRole(
                    message?.role
                );

            roles[role] =
                (
                    roles[role] ||
                    0
                ) + 1;
        }
    }

    return {
        conversations:
            records.length,

        messages:
            totalMessages,

        roles
    };
}

/* ============================================================
   الإحصائيات
============================================================ */

function calculateStatistics(
    records,
    mode
) {
    const textStats =
        estimateDatasetText(
            records
        );

    const base = {
        records:
            records.length,

        ...textStats,

        mode
    };

    if (
        mode ===
        "classification"
    ) {
        base.labels =
            analyzeLabels(
                records
            );
    }

    if (
        mode ===
        "chat"
    ) {
        base.chat =
            analyzeChat(
                records
            );
    }

    return base;
}

/* ============================================================
   إنشاء Manifest
============================================================ */

function createTrainingManifest(
    {
        dataset = {},
        mode,
        split,
        statistics,
        options,
        checksum
    }
) {
    return {
        manifestVersion:
            "1.0",

        trainingId:
            makeId(
                "training"
            ),

        engine: {
            name:
                "NOVA DATA AI Training Preparation Engine",

            version:
                CONFIG.VERSION
        },

        dataset: {
            id:
                dataset.id ||
                null,

            name:
                dataset.name ||
                "NOVA DATA AI Dataset",

            type:
                dataset.type ||
                "unknown",

            sourceCount:
                safeArray(
                    dataset.sources
                ).length
        },

        format: {
            mode,

            split
        },

        statistics,

        options,

        checksum,

        generatedAt:
            now()
    };
}

/* ============================================================
   تجهيز كامل
============================================================ */

function prepareForTraining({
    dataset = {},
    records,
    mode =
        CONFIG.DEFAULT_MODE,
    split =
        CONFIG.DEFAULT_SPLIT,
    options = {}
} = {}) {
    const startedAt =
        now();

    const safeRecords =
        safeArray(
            records ??
                dataset.records
        );

    validateRecords(
        safeRecords
    );

    const normalizedMode =
        String(
            mode ||
                CONFIG.DEFAULT_MODE
        )
            .toLowerCase();

    if (
        !CONFIG.SUPPORTED_MODES.includes(
            normalizedMode
        )
    ) {
        throw new TrainingError(
            `وضع التدريب غير مدعوم: ${normalizedMode}`,
            "UNSUPPORTED_MODE"
        );
    }

    /*
     * 1. إزالة الفراغ
     */
    const withoutEmpty =
        removeEmptyRecords(
            safeRecords
        );

    /*
     * 2. إزالة التكرار
     */
    let withoutDuplicates =
        withoutEmpty;

    let duplicatesRemoved =
        0;

    if (
        options.removeDuplicates !==
        false
    ) {
        const dedup =
            deduplicateRecords(
                withoutEmpty
            );

        withoutDuplicates =
            dedup.records;

        duplicatesRemoved =
            dedup.duplicates;
    }

    /*
     * 3. التحويل إلى صيغة التدريب
     */
    const transformed =
        transformRecords(
            withoutDuplicates,
            normalizedMode,
            options
        );

    /*
     * 4. إزالة التكرار مرة ثانية
     * بعد التحويل
     */
    let finalRecords =
        transformed.records;

    let transformedDuplicates =
        0;

    if (
        options.deduplicateAfterTransform !==
        false
    ) {
        const dedup =
            deduplicateTrainingRecords(
                transformed.records
            );

        finalRecords =
            dedup.records;

        transformedDuplicates =
            dedup.duplicates;
    }

    /*
     * 5. Shuffle + Split
     */
    const splitResult =
        splitDataset(
            finalRecords,
            split,
            {
                shuffle:
                    options.shuffle !==
                    false,

                seed:
                    options.seed ??
                    CONFIG.SEED_DEFAULT
            }
        );

    /*
     * 6. Statistics
     */
    const trainStats =
        calculateStatistics(
            splitResult.train,
            normalizedMode
        );

    const validationStats =
        calculateStatistics(
            splitResult.validation,
            normalizedMode
        );

    const testStats =
        calculateStatistics(
            splitResult.test,
            normalizedMode
        );

    const totalStats =
        calculateStatistics(
            finalRecords,
            normalizedMode
        );

    const allStatistics = {
        originalRecords:
            safeRecords.length,

        removedEmpty:
            safeRecords.length -
            withoutEmpty.length,

        duplicatesRemoved:
            duplicatesRemoved,

        rejectedDuringTransform:
            transformed.rejectedCount,

        duplicatesAfterTransform:
            transformedDuplicates,

        finalRecords:
            finalRecords.length,

        total:
            totalStats,

        train:
            trainStats,

        validation:
            validationStats,

        test:
            testStats
    };

    /*
     * 7. Checksum
     */
    const checksum =
        fingerprint(
            finalRecords
        );

    /*
     * 8. Manifest
     */
    const manifest =
        createTrainingManifest({
            dataset,

            mode:
                normalizedMode,

            split:
                splitResult.ratios,

            statistics:
                allStatistics,

            options: {
                ...options,

                shuffle:
                    options.shuffle !==
                    false,

                seed:
                    options.seed ??
                    CONFIG.SEED_DEFAULT
            },

            checksum
        });

    const finishedAt =
        now();

    return {
        success:
            true,

        trainingId:
            manifest.trainingId,

        engine:
            manifest.engine,

        mode:
            normalizedMode,

        records:
            finalRecords,

        splits: {
            train:
                splitResult.train,

            validation:
                splitResult.validation,

            test:
                splitResult.test
        },

        counts:
            splitResult.counts,

        ratios:
            splitResult.ratios,

        statistics:
            allStatistics,

        rejected:
            transformed.rejected,

        checksum,

        manifest,

        startedAt,

        finishedAt
    };
}

/* ============================================================
   تجهيز Batch
============================================================ */

function createBatches(
    records,
    batchSize =
        1000
) {
    validateRecords(
        records
    );

    const size =
        Math.max(
            1,
            Math.floor(
                Number(
                    batchSize
                ) || 1000
            )
        );

    const batches =
        [];

    for (
        let i = 0;
        i < records.length;
        i += size
    ) {
        batches.push(
            records.slice(
                i,
                i + size
            )
        );
    }

    return batches;
}

/* ============================================================
   تحويل Batch إلى JSONL
============================================================ */

function toJSONL(
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
   إنشاء ملفات التدريب في الذاكرة
============================================================ */

function generateTrainingFiles(
    prepared
) {
    if (
        !prepared ||
        typeof prepared !==
            "object"
    ) {
        throw new TrainingError(
            "نتيجة التحضير غير صالحة.",
            "INVALID_PREPARED_DATA"
        );
    }

    const train =
        safeArray(
            prepared.splits
                ?.train
        );

    const validation =
        safeArray(
            prepared.splits
                ?.validation
        );

    const test =
        safeArray(
            prepared.splits
                ?.test
        );

    const manifest =
        JSON.stringify(
            prepared.manifest,
            null,
            2
        );

    return {
        train: {
            format:
                "jsonl",

            content:
                toJSONL(
                    train
                ),

            records:
                train.length
        },

        validation: {
            format:
                "jsonl",

            content:
                toJSONL(
                    validation
                ),

            records:
                validation.length
        },

        test: {
            format:
                "jsonl",

            content:
                toJSONL(
                    test
                ),

            records:
                test.length
        },

        manifest: {
            format:
                "json",

            content:
                manifest
        }
    };
}

/* ============================================================
   تصدير ملفات التدريب إلى مجلد
============================================================ */

function ensureDirectory(
    directory
) {
    const fs =
        require("fs");

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

function cleanFileName(
    value
) {
    return (
        String(
            value ||
                "nova_training"
        )
            .trim()
            .replace(
                /[<>:"/\\|?*\u0000-\u001F]/g,
                "_"
            )
            .replace(
                /\s+/g,
                "_"
            )
            .slice(
                0,
                120
            ) ||
        "nova_training"
    );
}

function exportTrainingFiles({
    prepared,
    outputDirectory = ".",
    baseName =
        "nova_training"
}) {
    const fs =
        require("fs");

    if (
        !prepared
    ) {
        throw new TrainingError(
            "بيانات التدريب غير موجودة.",
            "MISSING_PREPARED_DATA"
        );
    }

    const directory =
        ensureDirectory(
            outputDirectory
        );

    const safeBaseName =
        cleanFileName(
            baseName
        );

    const paths = {
        train:
            `${safeBaseName}_train.jsonl`,

        validation:
            `${safeBaseName}_validation.jsonl`,

        test:
            `${safeBaseName}_test.jsonl`,

        manifest:
            `${safeBaseName}_manifest.json`
    };

    const generated =
        generateTrainingFiles(
            prepared
        );

    const outputPaths =
        {};

    fs.writeFileSync(
        `${directory}/${paths.train}`,
        generated.train.content,
        "utf8"
    );

    outputPaths.train =
        `${directory}/${paths.train}`;

    fs.writeFileSync(
        `${directory}/${paths.validation}`,
        generated.validation.content,
        "utf8"
    );

    outputPaths.validation =
        `${directory}/${paths.validation}`;

    fs.writeFileSync(
        `${directory}/${paths.test}`,
        generated.test.content,
        "utf8"
    );

    outputPaths.test =
        `${directory}/${paths.test}`;

    fs.writeFileSync(
        `${directory}/${paths.manifest}`,
        generated.manifest.content,
        "utf8"
    );

    outputPaths.manifest =
        `${directory}/${paths.manifest}`;

    return {
        success:
            true,

        directory,

        paths:
            outputPaths,

        counts: {
            train:
                generated.train.records,

            validation:
                generated.validation.records,

            test:
                generated.test.records
        },

        trainingId:
            prepared.trainingId
    };
}

/* ============================================================
   إنشاء نص Chat بسيط
============================================================ */

function conversationToText(
    conversation
) {
    if (
        !Array.isArray(
            conversation
        )
    ) {
        return "";
    }

    return conversation
        .map(
            message => {
                const role =
                    normalizeChatRole(
                        message?.role
                    );

                const content =
                    safeString(
                        message?.content
                    );

                return `${role}: ${content}`;
            }
        )
        .filter(
            Boolean
        )
        .join("\n");
}

/* ============================================================
   تحويل Chat إلى Text
============================================================ */

function chatToTextRecords(
    records
) {
    return safeArray(
        records
    )
        .map(
            record => ({
                text:
                    conversationToText(
                        record?.messages
                    )
            })
        )
        .filter(
            record =>
                record.text
                    .length >
                0
        );
}

/* ============================================================
   تحويل Instruction إلى Prompt
============================================================ */

function instructionToPromptRecords(
    records
) {
    return safeArray(
        records
    )
        .map(
            record => {
                const instruction =
                    safeString(
                        record?.instruction
                    );

                const input =
                    safeString(
                        record?.input
                    );

                const output =
                    safeString(
                        record?.output
                    );

                let prompt =
                    instruction;

                if (input) {
                    prompt +=
                        `\n\nInput:\n${input}`;
                }

                if (output) {
                    prompt +=
                        `\n\nOutput:\n${output}`;
                }

                return {
                    text:
                        prompt
                };
            }
        )
        .filter(
            record =>
                record.text
                    .length >
                0
        );
}

/* ============================================================
   تقسيم Dataset حسب Label
============================================================ */

function stratifiedClassificationSplit(
    records,
    split = CONFIG.DEFAULT_SPLIT,
    options = {}
) {
    validateRecords(
        records
    );

    const normalized =
        normalizeSplits(
            split
        );

    const groups =
        new Map();

    for (
        const record of
            records
    ) {
        const label =
            safeString(
                record?.label
            );

        if (
            !groups.has(
                label
            )
        ) {
            groups.set(
                label,
                []
            );
        }

        groups.get(
            label
        ).push(
            record
        );
    }

    const train =
        [];

    const validation =
        [];

    const test =
        [];

    for (
        const [
            label,
            group
        ] of groups.entries()
    ) {
        let working =
            group.slice();

        if (
            options.shuffle !==
            false
        ) {
            working =
                shuffleRecords(
                    working,
                    (
                        options.seed ??
                        CONFIG.SEED_DEFAULT
                    ) +
                        label.length
                );
        }

        const counts =
            calculateSplitCounts(
                working.length,
                normalized
            );

        train.push(
            ...working.slice(
                0,
                counts.train
            )
        );

        validation.push(
            ...working.slice(
                counts.train,
                counts.train +
                    counts.validation
            )
        );

        test.push(
            ...working.slice(
                counts.train +
                    counts.validation
            )
        );
    }

    return {
        train,

        validation,

        test,

        counts: {
            train:
                train.length,

            validation:
                validation.length,

            test:
                test.length,

            total:
                records.length
        },

        labels:
            [...groups.keys()]
    };
}

/* ============================================================
   فحص توازن التصنيفات
============================================================ */

function calculateClassBalance(
    records
) {
    const labels =
        analyzeLabels(
            records
        );

    if (
        labels.length ===
        0
    ) {
        return {
            classes: 0,

            balanced:
                false,

            labels: []
        };
    }

    const counts =
        labels.map(
            item =>
                item.count
        );

    const min =
        Math.min(
            ...counts
        );

    const max =
        Math.max(
            ...counts
        );

    const ratio =
        max === 0
            ? 0
            : min / max;

    return {
        classes:
            labels.length,

        minCount:
            min,

        maxCount:
            max,

        balanceRatio:
            Number(
                ratio.toFixed(
                    4
                )
            ),

        labels,

        /*
         * مؤشر تقريبي فقط.
         * ليس حكمًا علميًا على جودة Dataset.
         */
        balanced:
            ratio >= 0.5
    };
}

/* ============================================================
   إنشاء Training Card
============================================================ */

function createTrainingCard(
    prepared
) {
    return {
        trainingId:
            prepared.trainingId,

        mode:
            prepared.mode,

        records:
            prepared.counts?.total ||
            0,

        train:
            prepared.counts?.train ||
            0,

        validation:
            prepared.counts?.validation ||
            0,

        test:
            prepared.counts?.test ||
            0,

        checksum:
            prepared.checksum,

        generatedAt:
            prepared.finishedAt ||
            now()
    };
}

/* ============================================================
   معلومات المحرك
============================================================ */

function getEngineInfo() {
    return {
        name:
            "NOVA DATA AI Training Preparation Engine",

        version:
            CONFIG.VERSION,

        status:
            "ready",

        supportedModes:
            CONFIG.SUPPORTED_MODES,

        capabilities: [
            "Train split",
            "Validation split",
            "Test split",
            "Deterministic shuffle",
            "Generic dataset preparation",
            "Text dataset preparation",
            "Instruction dataset preparation",
            "Classification dataset preparation",
            "Chat dataset preparation",
            "Seq2Seq dataset preparation",
            "Label analysis",
            "Class balance analysis",
            "JSONL generation",
            "Manifest generation",
            "Batch creation",
            "Training file export"
        ],

        limits: {
            maxRecords:
                CONFIG.MAX_RECORDS,

            maxTextLength:
                CONFIG.MAX_TEXT_LENGTH
        },

        note:
            "هذا المحرك يجهز البيانات ولا ينفذ تدريب نموذج الذكاء الاصطناعي."
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
        TrainingError
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

const training =
    Object.freeze({
        version:
            CONFIG.VERSION,

        config:
            CONFIG,

        TrainingError,

        makeId,

        now,

        safeArray,

        safeString,

        isObject,

        clone,

        stableSerialize,

        fingerprint,

        validateRecords,

        isEmptyRecord,

        removeEmptyRecords,

        deduplicateRecords,

        createSeededRandom,

        shuffleRecords,

        normalizeSplits,

        calculateSplitCounts,

        splitDataset,

        extractText,

        toGenericRecord,

        toTextRecord,

        toInstructionRecord,

        toClassificationRecord,

        normalizeChatRole,

        toChatRecord,

        toSeq2SeqRecord,

        convertRecord,

        isTrainingRecordUsable,

        transformRecords,

        estimateTextLength,

        collectTextFromTrainingRecord,

        estimateDatasetText,

        analyzeLabels,

        analyzeChat,

        calculateStatistics,

        createTrainingManifest,

        prepareForTraining,

        createBatches,

        toJSONL,

        generateTrainingFiles,

        ensureDirectory,

        cleanFileName,

        exportTrainingFiles,

        conversationToText,

        chatToTextRecords,

        instructionToPromptRecords,

        stratifiedClassificationSplit,

        calculateClassBalance,

        createTrainingCard,

        getEngineInfo,

        serializeError
    });

/* ============================================================
   التصدير
============================================================ */

module.exports =
    training;

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
        "   NOVA DATA AI - TRAINING PREPARATION ENGINE"
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
        "Supported modes:"
    );

    for (
        const mode of
            CONFIG.SUPPORTED_MODES
    ) {
        console.log(
            `- ${mode}`
        );
    }

    console.log("");

    const testData = [
        {
            instruction:
                "ما هو الذكاء الاصطناعي؟",

            input:
                "اشرح بشكل مبسط.",

            output:
                "هو مجال من علوم الحاسوب يركز على بناء أنظمة تستطيع تنفيذ مهام تتطلب عادةً قدرات ذكية."
        },

        {
            instruction:
                "ما هو CSV؟",

            input:
                "",

            output:
                "صيغة نصية تستخدم لتمثيل البيانات الجدولية."
        },

        {
            instruction:
                "",

            input:
                "",

            output:
                ""
        }
    ];

    try {
        const prepared =
            prepareForTraining({
                dataset: {
                    id:
                        "test_dataset",

                    name:
                        "NOVA Test Dataset",

                    type:
                        "instruction"
                },

                records:
                    testData,

                mode:
                    "instruction",

                split: {
                    train:
                        0.8,

                    validation:
                        0.1,

                    test:
                        0.1
                },

                options: {
                    shuffle:
                        true,

                    seed:
                        42,

                    removeDuplicates:
                        true,

                    deduplicateAfterTransform:
                        true
                }
            });

        console.log(
            `Original: ${prepared.statistics.originalRecords}`
        );

        console.log(
            `Final: ${prepared.statistics.finalRecords}`
        );

        console.log(
            `Train: ${prepared.counts.train}`
        );

        console.log(
            `Validation: ${prepared.counts.validation}`
        );

        console.log(
            `Test: ${prepared.counts.test}`
        );

        console.log(
            `Estimated tokens: ${prepared.statistics.total.estimatedTokens}`
        );

        console.log(
            `Checksum: ${prepared.checksum}`
        );

        console.log(
            "TRAINING PREPARATION TEST: SUCCESS"
        );
    } catch (
        error
    ) {
        console.error(
            "TRAINING PREPARATION TEST: FAILED"
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
