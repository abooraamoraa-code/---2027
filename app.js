"use strict";

/**
 * ============================================================
 * NOVA DATA AI
 * MAIN APPLICATION BOOTSTRAP
 * File: app.js
 * Version: 1.0.0
 *
 * الوظيفة:
 * - تشغيل المشروع من نقطة واحدة
 * - فحص الملفات والمحركات الأساسية
 * - التأكد من تحميل المحركات
 * - عرض حالة NOVA DATA AI
 * - تشغيل server.js
 *
 * التشغيل:
 * node app.js
 *
 * لا يحتاج API Key لتشغيل المحركات الأساسية.
 * ============================================================
 */

const fs = require("fs");
const path = require("path");

/* ============================================================
   معلومات التطبيق
============================================================ */

const APP = Object.freeze({
    name: "NOVA DATA AI",

    version: "1.0.0",

    description:
        "منصة جمع وتنظيف والتحقق وتجهيز البيانات للذكاء الاصطناعي.",

    requiredFiles: [
        "index.html",
        "server.js",
        "package.json",
        ".env",
        ".env.example",
        ".gitignore",
        "collector.js",
        "cleaner.js",
        "validator.js",
        "file-engine.js",
        "processor.js",
        "exporter.js",
        "training.js"
    ],

    engines: [
        "collector.js",
        "cleaner.js",
        "validator.js",
        "file-engine.js",
        "processor.js",
        "exporter.js",
        "training.js"
    ]
});

/* ============================================================
   ألوان الطرفية
============================================================ */

const ANSI = Object.freeze({
    reset: "\x1b[0m",
    bright: "\x1b[1m",

    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    white: "\x1b[37m"
});

/* ============================================================
   طباعة
============================================================ */

function line() {
    console.log(
        "============================================================"
    );
}

function print(
    message = ""
) {
    console.log(
        message
    );
}

function success(
    message
) {
    console.log(
        `${ANSI.green}✓${ANSI.reset} ${message}`
    );
}

function warning(
    message
) {
    console.log(
        `${ANSI.yellow}!${ANSI.reset} ${message}`
    );
}

function failure(
    message
) {
    console.log(
        `${ANSI.red}✗${ANSI.reset} ${message}`
    );
}

function title(
    message
) {
    console.log(
        `${ANSI.bright}${ANSI.cyan}${message}${ANSI.reset}`
    );
}

/* ============================================================
   الوقت
============================================================ */

function now() {
    return new Date().toISOString();
}

/* ============================================================
   المسار الرئيسي
============================================================ */

const ROOT =
    __dirname;

/* ============================================================
   فحص Node.js
============================================================ */

function checkNodeVersion() {
    const major =
        Number(
            process.versions
                .node
                .split(".")[0]
        );

    if (
        !Number.isFinite(
            major
        )
    ) {
        return {
            success: false,
            version:
                process.versions.node
        };
    }

    return {
        success:
            major >= 20,

        version:
            process.versions.node,

        major
    };
}

/* ============================================================
   فحص الملفات
============================================================ */

function checkRequiredFiles() {
    const results = [];

    for (
        const file of
            APP.requiredFiles
    ) {
        const filePath =
            path.join(
                ROOT,
                file
            );

        const exists =
            fs.existsSync(
                filePath
            );

        results.push({
            file,
            exists,
            path:
                filePath
        });
    }

    return results;
}

/* ============================================================
   فحص package.json
============================================================ */

function checkPackage() {
    const packagePath =
        path.join(
            ROOT,
            "package.json"
        );

    if (
        !fs.existsSync(
            packagePath
        )
    ) {
        return {
            success: false,
            error:
                "package.json غير موجود."
        };
    }

    try {
        const packageData =
            JSON.parse(
                fs.readFileSync(
                    packagePath,
                    "utf8"
                )
            );

        return {
            success: true,

            name:
                packageData.name,

            version:
                packageData.version,

            main:
                packageData.main,

            dependencies:
                packageData.dependencies ||
                {}
        };
    } catch (
        error
    ) {
        return {
            success: false,

            error:
                error.message
        };
    }
}

/* ============================================================
   فحص محرك
============================================================ */

function loadEngine(
    file
) {
    const fullPath =
        path.join(
            ROOT,
            file
        );

    try {
        const engine =
            require(
                fullPath
            );

        return {
            success: true,

            file,

            engine,

            version:
                engine?.version ||
                "unknown",

            status:
                engine
                    ?.getEngineInfo
                    ? "ready"
                    : "loaded"
        };
    } catch (
        error
    ) {
        return {
            success: false,

            file,

            error:
                error.message
        };
    }
}

/* ============================================================
   تحميل كل المحركات
============================================================ */

function loadAllEngines() {
    const results = [];

    for (
        const file of
            APP.engines
    ) {
        const result =
            loadEngine(
                file
            );

        results.push(
            result
        );
    }

    return results;
}

/* ============================================================
   فحص معلومات المحركات
============================================================ */

function inspectEngine(
    result
) {
    if (
        !result.success
    ) {
        return {
            success: false,

            file:
                result.file,

            error:
                result.error
        };
    }

    let info = null;

    try {
        if (
            typeof result
                .engine
                ?.getEngineInfo ===
            "function"
        ) {
            info =
                result
                    .engine
                    .getEngineInfo();
        }
    } catch {
        info = null;
    }

    return {
        success: true,

        file:
            result.file,

        version:
            result.version,

        status:
            info?.status ||
            result.status,

        name:
            info?.name ||
            result.file
    };
}

/* ============================================================
   فحص البيئة
============================================================ */

function checkEnvironment() {
    return {
        node:
            checkNodeVersion(),

        platform:
            process.platform,

        architecture:
            process.arch,

        cwd:
            process.cwd(),

        root:
            ROOT,

        environment:
            process.env.NODE_ENV ||
            "development",

        time:
            now()
    };
}

/* ============================================================
   إنشاء حالة المشروع
============================================================ */

function createSystemStatus({
    environment,
    files,
    packageInfo,
    engines
}) {
    const missingFiles =
        files.filter(
            item =>
                !item.exists
        );

    const failedEngines =
        engines.filter(
            item =>
                !item.success
        );

    const nodeOK =
        environment
            .node
            .success;

    const packageOK =
        packageInfo.success;

    const success =
        nodeOK &&
        packageOK &&
        missingFiles.length === 0 &&
        failedEngines.length === 0;

    return {
        success,

        application: {
            name:
                APP.name,

            version:
                APP.version
        },

        node: {
            version:
                environment
                    .node
                    .version,

            supported:
                nodeOK
        },

        package: {
            valid:
                packageOK,

            name:
                packageInfo
                    .name ||
                null,

            version:
                packageInfo
                    .version ||
                null
        },

        files: {
            total:
                files.length,

            available:
                files.filter(
                    item =>
                        item.exists
                ).length,

            missing:
                missingFiles
                    .length
        },

        engines: {
            total:
                engines.length,

            ready:
                engines.filter(
                    item =>
                        item.success
                ).length,

            failed:
                failedEngines
                    .length
        },

        missingFiles:
            missingFiles.map(
                item =>
                    item.file
            ),

        failedEngines:
            failedEngines.map(
                item => ({
                    file:
                        item.file,

                    error:
                        item.error
                })
            ),

        time:
            now()
    };
}

/* ============================================================
   طباعة حالة النظام
============================================================ */

function displaySystemStatus(
    status,
    engineInfos
) {
    print("");

    line();

    title(
        "             NOVA DATA AI"
    );

    title(
        "          SYSTEM BOOT CHECK"
    );

    line();

    print("");

    print(
        `التطبيق: ${APP.name}`
    );

    print(
        `الإصدار: ${APP.version}`
    );

    print("");

    /*
     * Node
     */
    if (
        status.node.supported
    ) {
        success(
            `Node.js ${status.node.version}`
        );
    } else {
        failure(
            `إصدار Node.js غير مدعوم: ${status.node.version}`
        );
    }

    /*
     * Package
     */
    if (
        status.package.valid
    ) {
        success(
            `package.json: ${status.package.name || "OK"}`
        );
    } else {
        failure(
            "package.json: غير صالح"
        );
    }

    print("");

    print(
        `الملفات: ${status.files.available}/${status.files.total}`
    );

    print(
        `المحركات: ${status.engines.ready}/${status.engines.total}`
    );

    print("");

    title(
        "حالة المحركات:"
    );

    for (
        const engine of
            engineInfos
    ) {
        if (
            engine.success
        ) {
            success(
                `${engine.name} | v${engine.version}`
            );
        } else {
            failure(
                `${engine.file} | ${engine.error}`
            );
        }
    }

    print("");

    if (
        status.success
    ) {
        success(
            "SYSTEM CHECK: PASSED"
        );
    } else {
        failure(
            "SYSTEM CHECK: FAILED"
        );
    }

    line();

    print("");
}

/* ============================================================
   فحص server.js
============================================================ */

function checkServerFile() {
    const serverPath =
        path.join(
            ROOT,
            "server.js"
        );

    if (
        !fs.existsSync(
            serverPath
        )
    ) {
        return {
            success: false,
            error:
                "server.js غير موجود."
        };
    }

    try {
        /*
         * لا نستدعي require هنا حتى لا يبدأ
         * الخادم قبل انتهاء فحص النظام.
         */
        const content =
            fs.readFileSync(
                serverPath,
                "utf8"
            );

        if (
            !content.trim()
        ) {
            return {
                success: false,
                error:
                    "server.js فارغ."
            };
        }

        return {
            success: true,
            bytes:
                Buffer.byteLength(
                    content,
                    "utf8"
                )
        };
    } catch (
        error
    ) {
        return {
            success: false,
            error:
                error.message
        };
    }
}

/* ============================================================
   بدء الخادم
============================================================ */

function startServer() {
    const serverPath =
        path.join(
            ROOT,
            "server.js"
        );

    if (
        !fs.existsSync(
            serverPath
        )
    ) {
        throw new Error(
            "server.js غير موجود."
        );
    }

    /*
     * تشغيل server.js
     * السيرفر نفسه مسؤول عن listen().
     */
    require(
        serverPath
    );
}

/* ============================================================
   معالجة الإغلاق
============================================================ */

function setupShutdownHandlers() {
    const shutdown =
        signal => {
            print("");

            warning(
                `تم استقبال ${signal}.`
            );

            print(
                "NOVA DATA AI يغلق بأمان..."
            );

            process.exit(
                0
            );
        };

    process.once(
        "SIGINT",
        () =>
            shutdown(
                "SIGINT"
            )
    );

    process.once(
        "SIGTERM",
        () =>
            shutdown(
                "SIGTERM"
            )
    );
}

/* ============================================================
   التقاط الأخطاء
============================================================ */

function setupErrorHandlers() {
    process.on(
        "uncaughtException",
        error => {
            print("");

            failure(
                "حدث خطأ غير متوقع في التطبيق."
            );

            console.error(
                error
            );
        }
    );

    process.on(
        "unhandledRejection",
        reason => {
            print("");

            failure(
                "حدث خطأ غير معالج في Promise."
            );

            console.error(
                reason
            );
        }
    );
}

/* ============================================================
   بناء تقرير الإقلاع
============================================================ */

function createBootReport({
    status,
    engineInfos,
    serverCheck
}) {
    return {
        application:
            APP.name,

        version:
            APP.version,

        bootId:
            `boot_${Date.now()}_${Math.random()
                .toString(36)
                .slice(2, 10)}`,

        timestamp:
            now(),

        system:
            status,

        server:
            serverCheck,

        engines:
            engineInfos
    };
}

/* ============================================================
   التحقق من مجلد المشروع
============================================================ */

function checkProjectRoot() {
    try {
        const stats =
            fs.statSync(
                ROOT
            );

        return {
            success:
                stats.isDirectory(),

            path:
                ROOT
        };
    } catch (
        error
    ) {
        return {
            success: false,

            error:
                error.message
        };
    }
}

/* ============================================================
   التشغيل الرئيسي
============================================================ */

async function boot() {
    setupShutdownHandlers();

    setupErrorHandlers();

    print("");

    line();

    title(
        "        NOVA DATA AI BOOTING..."
    );

    line();

    print("");

    /*
     * فحص مجلد المشروع
     */
    const rootCheck =
        checkProjectRoot();

    if (
        !rootCheck.success
    ) {
        throw new Error(
            "تعذر الوصول إلى مجلد المشروع."
        );
    }

    success(
        "Project root: OK"
    );

    /*
     * البيئة
     */
    const environment =
        checkEnvironment();

    success(
        `Environment: ${environment.environment}`
    );

    /*
     * Node
     */
    if (
        environment.node.success
    ) {
        success(
            `Node.js: ${environment.node.version}`
        );
    } else {
        failure(
            `Node.js غير مدعوم: ${environment.node.version}`
        );

        process.exitCode =
            1;

        return;
    }

    /*
     * package
     */
    const packageInfo =
        checkPackage();

    if (
        packageInfo.success
    ) {
        success(
            `Package: ${packageInfo.name || APP.name}`
        );
    } else {
        failure(
            `Package check failed: ${packageInfo.error}`
        );
    }

    /*
     * الملفات
     */
    print("");

    title(
        "فحص ملفات المشروع:"
    );

    const files =
        checkRequiredFiles();

    for (
        const file of
            files
    ) {
        if (
            file.exists
        ) {
            success(
                file.file
            );
        } else {
            failure(
                `${file.file} مفقود`
            );
        }
    }

    /*
     * المحركات
     */
    print("");

    title(
        "تحميل المحركات:"
    );

    const engineResults =
        loadAllEngines();

    const engineInfos =
        engineResults.map(
            inspectEngine
        );

    for (
        const engine of
            engineInfos
    ) {
        if (
            engine.success
        ) {
            success(
                `${engine.name} | ${engine.version}`
            );
        } else {
            failure(
                `${engine.file}: ${engine.error}`
            );
        }
    }

    /*
     * server
     */
    print("");

    title(
        "فحص الخادم:"
    );

    const serverCheck =
        checkServerFile();

    if (
        serverCheck.success
    ) {
        success(
            `server.js: ${serverCheck.bytes} bytes`
        );
    } else {
        failure(
            `server.js: ${serverCheck.error}`
        );
    }

    /*
     * حالة النظام
     */
    const status =
        createSystemStatus({
            environment,
            files,
            packageInfo,
            engines:
                engineResults
        });

    print("");

    line();

    if (
        status.success
    ) {
        success(
            "NOVA DATA AI READY"
        );
    } else {
        warning(
            "NOVA DATA AI يحتاج إلى إصلاح بعض الملفات قبل التشغيل."
        );
    }

    line();

    /*
     * تقرير
     */
    const bootReport =
        createBootReport({
            status,
            engineInfos,
            serverCheck
        });

    print("");

    title(
        "Boot ID:"
    );

    print(
        bootReport.bootId
    );

    print("");

    /*
     * لا نشغل الخادم إذا كانت ملفات المحركات الأساسية
     * مفقودة.
     */
    if (
        !status.success
    ) {
        print("");

        warning(
            "لم يتم تشغيل الخادم لأن فحص النظام لم ينجح."
        );

        print("");

        process.exitCode =
            1;

        return;
    }

    /*
     * تشغيل الخادم
     */
    print("");

    line();

    title(
        "       STARTING NOVA DATA AI SERVER"
    );

    line();

    print("");

    try {
        startServer();
    } catch (
        error
    ) {
        print("");

        failure(
            "فشل تشغيل server.js."
        );

        console.error(
            error
        );

        process.exitCode =
            1;
    }
}

/* ============================================================
   تصدير معلومات التطبيق
============================================================ */

const application =
    Object.freeze({
        APP,

        ROOT,

        checkNodeVersion,

        checkRequiredFiles,

        checkPackage,

        loadEngine,

        loadAllEngines,

        inspectEngine,

        checkEnvironment,

        createSystemStatus,

        displaySystemStatus,

        checkServerFile,

        startServer,

        createBootReport,

        checkProjectRoot,

        boot
    });

module.exports =
    application;

/* ============================================================
   التشغيل المباشر
============================================================ */

if (
    require.main ===
    module
) {
    boot().catch(
        error => {
            print("");

            failure(
                "فشل تشغيل NOVA DATA AI."
            );

            console.error(
                error
            );

            process.exitCode =
                1;
        }
    );
}
