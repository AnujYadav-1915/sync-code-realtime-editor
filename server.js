require('dotenv').config();

const express = require('express');
const app = express();
const cors = require('cors');

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const {spawn, spawnSync} = require('child_process');
const {Server} = require('socket.io');

let nodemailer = null;
try {
    nodemailer = require('nodemailer');
} catch (error) {
    nodemailer = null;
}

const ACTIONS = require('./src/actions/Actions');

const server = http.createServer(app);
const io = new Server(server);
const serverStartedAt = Date.now();

const DATA_DIR = path.join(__dirname, 'data');
const ROOM_STATE_FILE = path.join(DATA_DIR, 'room-state.json');
const PROBLEM_LIBRARY_FILE = path.join(DATA_DIR, 'problem-library.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USER_PROGRESS_FILE = path.join(DATA_DIR, 'user-progress.json');
const COMPANY_TRACKS_FILE = path.join(DATA_DIR, 'company-tracks.json');
const PRACTICE_SHEETS_FILE = path.join(DATA_DIR, 'practice-sheets.json');
const SOLUTION_NOTEBOOK_FILE = path.join(DATA_DIR, 'solution-notebook.json');

app.disable('x-powered-by');

const allowedOrigins = `${process.env.ALLOWED_ORIGINS || ''}`
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = allowedOrigins.length > 0
    ? {
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
    }
    : {};

app.use(cors(corsOptions));
app.use(express.json({limit: '1mb'}));
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

const apiRateWindowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60000);
const apiRateMaxRequests = Number(process.env.API_RATE_LIMIT_MAX || 180);
const apiRateStore = new Map();

const applyApiRateLimit = (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || 'unknown'}:${req.path}`;
    const record = apiRateStore.get(key) || {count: 0, startedAt: now};

    if (now - record.startedAt >= apiRateWindowMs) {
        record.count = 0;
        record.startedAt = now;
    }

    record.count += 1;
    apiRateStore.set(key, record);

    if (record.count > apiRateMaxRequests) {
        const retryAfterSeconds = Math.max(1, Math.ceil((apiRateWindowMs - (now - record.startedAt)) / 1000));
        res.setHeader('Retry-After', `${retryAfterSeconds}`);
        return res.status(429).json({
            error: 'Too many requests. Please retry shortly.',
        });
    }

    if (apiRateStore.size > 10000) {
        for (const [entryKey, entryValue] of apiRateStore.entries()) {
            if (now - entryValue.startedAt > apiRateWindowMs) {
                apiRateStore.delete(entryKey);
            }
        }
    }

    next();
};

app.use('/api', applyApiRateLimit);

const languageMap = {
    clike: 'cpp',
    java: 'java',
    javascript: 'javascript',
    jsx: 'javascript',
    python: 'python',
    php: 'php',
    go: 'go',
    r: 'r',
    rust: 'rust',
    ruby: 'ruby',
    shell: 'bash',
    swift: 'swift',
};

const collaborationColorPalette = ['#F472B6', '#22D3EE', '#34D399', '#FBBF24', '#A78BFA', '#FB7185'];

const judgeLanguageProfiles = {
    cpp: {defaultTimeLimitMs: 1500, defaultMemoryLimitKb: 131072, maxTimeLimitMs: 5000, maxMemoryLimitKb: 262144},
    java: {defaultTimeLimitMs: 2200, defaultMemoryLimitKb: 262144, maxTimeLimitMs: 7000, maxMemoryLimitKb: 524288},
    javascript: {defaultTimeLimitMs: 2200, defaultMemoryLimitKb: 196608, maxTimeLimitMs: 7000, maxMemoryLimitKb: 393216},
    python: {defaultTimeLimitMs: 3000, defaultMemoryLimitKb: 262144, maxTimeLimitMs: 9000, maxMemoryLimitKb: 524288},
    php: {defaultTimeLimitMs: 2600, defaultMemoryLimitKb: 196608, maxTimeLimitMs: 7000, maxMemoryLimitKb: 393216},
    go: {defaultTimeLimitMs: 1700, defaultMemoryLimitKb: 131072, maxTimeLimitMs: 5500, maxMemoryLimitKb: 262144},
    r: {defaultTimeLimitMs: 3200, defaultMemoryLimitKb: 262144, maxTimeLimitMs: 9000, maxMemoryLimitKb: 524288},
    rust: {defaultTimeLimitMs: 1700, defaultMemoryLimitKb: 131072, maxTimeLimitMs: 5500, maxMemoryLimitKb: 262144},
    ruby: {defaultTimeLimitMs: 2800, defaultMemoryLimitKb: 262144, maxTimeLimitMs: 8000, maxMemoryLimitKb: 524288},
    bash: {defaultTimeLimitMs: 1800, defaultMemoryLimitKb: 131072, maxTimeLimitMs: 5000, maxMemoryLimitKb: 262144},
    swift: {defaultTimeLimitMs: 2200, defaultMemoryLimitKb: 196608, maxTimeLimitMs: 7000, maxMemoryLimitKb: 393216},
};

const localRuntimeRequirements = {
    cpp: ['c++'],
    java: ['javac', 'java'],
    javascript: ['node'],
    python: ['python3'],
    php: ['php'],
    go: ['go'],
    r: ['Rscript'],
    rust: ['rustc'],
    ruby: ['ruby'],
    bash: ['bash'],
    swift: ['swift'],
};

const isBinaryAvailable = (binaryName) => {
    try {
        const probe = spawnSync(binaryName, ['--version'], {
            encoding: 'utf8',
            stdio: 'ignore',
        });

        if (probe.error) {
            return false;
        }

        return typeof probe.status === 'number';
    } catch (error) {
        return false;
    }
};

const getRuntimeStatusByEditorLanguage = () => {
    const executionProvider = `${process.env.EXECUTION_PROVIDER || 'auto'}`.toLowerCase();
    const allowLocalFallback = process.env.ALLOW_LOCAL_EXECUTION_FALLBACK !== 'false';

    return Object.entries(languageMap).reduce((accumulator, [editorLanguage, executionLanguage]) => {
        const requirements = localRuntimeRequirements[executionLanguage] || [];
        const missingBinaries = requirements.filter((binaryName) => !isBinaryAvailable(binaryName));
        const localAvailable = missingBinaries.length === 0;

        let available = true;
        if (executionProvider === 'local') {
            available = localAvailable;
        }

        accumulator[editorLanguage] = {
            executionLanguage,
            localAvailable,
            missingBinaries,
            available,
            mode: executionProvider,
            allowLocalFallback,
        };
        return accumulator;
    }, {});
};

const defaultProblemLibrary = [
    {
        id: 'sum-two-numbers',
        title: 'Sum of Two Numbers',
        difficulty: 'easy',
        category: 'math',
        tags: ['math', 'basics'],
        statement: 'Read two integers a and b (each on a separate line) and print their sum.',
        targetTimeComplexity: 'O(1)',
        targetSpaceComplexity: 'O(1)',
        timeLimitMs: 2000,
        memoryLimitKb: 131072,
        timerDurationSeconds: 600,
        visibleTestCases: [{input: '3\n5', output: '8'}],
        hiddenTestCases: [{input: '100\n250', output: '350'}, {input: '-7\n3', output: '-4'}],
    },
    {
        id: 'reverse-string',
        title: 'Reverse a String',
        difficulty: 'easy',
        category: 'strings',
        tags: ['string', 'two-pointers'],
        statement: 'Read a single string and print the reversed string.',
        targetTimeComplexity: 'O(n)',
        targetSpaceComplexity: 'O(n)',
        timeLimitMs: 2000,
        memoryLimitKb: 131072,
        timerDurationSeconds: 600,
        visibleTestCases: [{input: 'hello', output: 'olleh'}],
        hiddenTestCases: [{input: 'algorithm', output: 'mhtirogla'}],
    },
    {
        id: 'max-subarray-kadane',
        title: 'Maximum Subarray Sum',
        difficulty: 'medium',
        category: 'arrays',
        tags: ['arrays', 'dp', 'greedy'],
        statement: 'Given n and an array, print the maximum sum of any contiguous subarray using Kadane\'s algorithm.',
        targetTimeComplexity: 'O(n)',
        targetSpaceComplexity: 'O(1)',
        timeLimitMs: 2500,
        memoryLimitKb: 131072,
        timerDurationSeconds: 1800,
        visibleTestCases: [{input: '5\n-2 1 -3 4 -1', output: '4'}],
        hiddenTestCases: [{input: '8\n-2 -3 4 -1 -2 1 5 -3', output: '7'}],
    },
];

const createDefaultRoomState = () => ({
    ownerUsername: '',
    latestCode: '',
    problem: {
        title: '',
        statement: '',
        targetTimeComplexity: '',
        targetSpaceComplexity: '',
        timeLimitMs: 2000,
        memoryLimitKb: 131072,
        visibleTestCasesText: '',
        hiddenTestCasesText: '',
    },
    timer: {
        durationSeconds: 1800,
        startedAt: null,
    },
    submissions: [],
});

const sanitizeRoomState = (roomState = createDefaultRoomState()) => ({
    ownerUsername: roomState.ownerUsername,
    latestCode: roomState.latestCode,
    problem: {
        ...roomState.problem,
        hiddenTestCasesText: '',
    },
    timer: roomState.timer,
    submissions: roomState.submissions,
});

const getRoomStateForUser = (roomState, isOwner) => (isOwner ? roomState : sanitizeRoomState(roomState));

const mergeRoomState = (existingState, updates = {}) => ({
    ...existingState,
    ...updates,
    problem: {
        ...existingState.problem,
        ...(updates.problem || {}),
    },
    timer: {
        ...existingState.timer,
        ...(updates.timer || {}),
    },
    submissions: updates.submissions || existingState.submissions,
});

const ensurePersistenceStore = () => {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, {recursive: true});
    }

    if (!fs.existsSync(ROOM_STATE_FILE)) {
        fs.writeFileSync(ROOM_STATE_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(PROBLEM_LIBRARY_FILE)) {
        fs.writeFileSync(PROBLEM_LIBRARY_FILE, JSON.stringify(defaultProblemLibrary, null, 2));
    }

    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    }

    if (!fs.existsSync(USER_PROGRESS_FILE)) {
        fs.writeFileSync(USER_PROGRESS_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(COMPANY_TRACKS_FILE)) {
        fs.writeFileSync(COMPANY_TRACKS_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(PRACTICE_SHEETS_FILE)) {
        fs.writeFileSync(PRACTICE_SHEETS_FILE, JSON.stringify({}, null, 2));
    }

    if (!fs.existsSync(SOLUTION_NOTEBOOK_FILE)) {
        fs.writeFileSync(SOLUTION_NOTEBOOK_FILE, JSON.stringify({}, null, 2));
    }
};

const loadJsonFile = (filePath, fallback) => {
    try {
        ensurePersistenceStore();
        const rawValue = fs.readFileSync(filePath, 'utf8');
        const parsedValue = JSON.parse(rawValue || 'null');
        return parsedValue ?? fallback;
    } catch (error) {
        return fallback;
    }
};

const persistJsonFile = (filePath, value) => {
    ensurePersistenceStore();
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const DEFAULT_COMPANY_TRACKS = {
    google: {
        company: 'Google',
        description: 'Focus on graphs, trees, strings, and DP with medium-hard progression.',
        categories: ['graphs', 'binary-trees', 'strings', 'dynamic-programming'],
        targetDifficulties: ['medium', 'hard'],
    },
    amazon: {
        company: 'Amazon',
        description: 'Arrays, heaps, sliding window, and design-style implementation patterns.',
        categories: ['arrays', 'heap', 'sliding-window', 'hashing'],
        targetDifficulties: ['easy', 'medium'],
    },
    meta: {
        company: 'Meta',
        description: 'Graph traversal, trees, and practical string/hashmap optimization.',
        categories: ['graphs', 'binary-trees', 'strings', 'hashing'],
        targetDifficulties: ['medium', 'hard'],
    },
    microsoft: {
        company: 'Microsoft',
        description: 'DP, recursion/backtracking, and clean implementation under constraints.',
        categories: ['dynamic-programming', 'backtracking', 'arrays', 'matrix'],
        targetDifficulties: ['medium'],
    },
    netflix: {
        company: 'Netflix',
        description: 'High-signal optimization focused on graphs, greedy, and systems-minded problems.',
        categories: ['graphs', 'greedy', 'searching', 'heap'],
        targetDifficulties: ['medium', 'hard'],
    },
};

const DEFAULT_SHEET_TEMPLATES = {
    blind75: {
        id: 'blind75',
        title: 'Blind 75',
        description: 'Classic high-impact interview question set.',
        items: [],
    },
    neetcode150: {
        id: 'neetcode150',
        title: 'NeetCode 150',
        description: 'Expanded interview sheet covering broad DSA coverage.',
        items: [],
    },
};

const loadCompanyTracks = () => {
    const tracks = loadJsonFile(COMPANY_TRACKS_FILE, {});
    if (!tracks || Object.keys(tracks).length === 0) {
        persistJsonFile(COMPANY_TRACKS_FILE, DEFAULT_COMPANY_TRACKS);
        return DEFAULT_COMPANY_TRACKS;
    }
    return tracks;
};

const loadPracticeSheets = () => {
    const sheets = loadJsonFile(PRACTICE_SHEETS_FILE, {});
    if (!sheets || Object.keys(sheets).length === 0) {
        persistJsonFile(PRACTICE_SHEETS_FILE, {
            templates: DEFAULT_SHEET_TEMPLATES,
            userSheets: {},
            checkIns: {},
            reminders: {},
        });
        return {
            templates: DEFAULT_SHEET_TEMPLATES,
            userSheets: {},
            checkIns: {},
            reminders: {},
        };
    }
    return sheets;
};

const loadUserProgress = () => loadJsonFile(USER_PROGRESS_FILE, {});
const loadSolutionNotebook = () => loadJsonFile(SOLUTION_NOTEBOOK_FILE, {});

const upsertUserProgressRecord = ({username, category, difficulty, passed, elapsedMs = 0, errorType = 'none'}) => {
    if (!username) {
        return;
    }

    const progressMap = loadUserProgress();
    const current = progressMap[username] || {
        submissions: [],
        topicStats: {},
    };

    const nextSubmission = {
        category: normalizeCategory(category),
        difficulty: VALID_DIFFICULTIES.includes(`${difficulty}`.toLowerCase()) ? `${difficulty}`.toLowerCase() : 'medium',
        passed: Boolean(passed),
        elapsedMs: Number(elapsedMs) || 0,
        errorType: errorType || 'none',
        createdAt: Date.now(),
    };

    current.submissions = [nextSubmission, ...(current.submissions || [])].slice(0, 300);

    const topicKey = nextSubmission.category || 'other';
    const topicStats = current.topicStats[topicKey] || {
        attempts: 0,
        solved: 0,
        totalElapsedMs: 0,
        errors: {wrongAnswer: 0, tle: 0, runtime: 0},
    };
    topicStats.attempts += 1;
    if (nextSubmission.passed) topicStats.solved += 1;
    topicStats.totalElapsedMs += nextSubmission.elapsedMs;
    if (nextSubmission.errorType === 'wrongAnswer') topicStats.errors.wrongAnswer += 1;
    if (nextSubmission.errorType === 'tle') topicStats.errors.tle += 1;
    if (nextSubmission.errorType === 'runtime') topicStats.errors.runtime += 1;
    current.topicStats[topicKey] = topicStats;

    progressMap[username] = current;
    persistJsonFile(USER_PROGRESS_FILE, progressMap);
};

const getAdaptiveRecommendations = (username, problemLibrary = []) => {
    const progressMap = loadUserProgress();
    const userProgress = progressMap[username] || {topicStats: {}};
    const topicEntries = Object.entries(userProgress.topicStats || {});

    const weaknessScores = topicEntries
        .map(([topic, stats]) => {
            const attempts = Number(stats.attempts || 0);
            const solved = Number(stats.solved || 0);
            const avgTimeMs = attempts > 0 ? Number(stats.totalElapsedMs || 0) / attempts : 0;
            const failureRate = attempts > 0 ? 1 - solved / attempts : 1;
            const errorPressure = Number(stats.errors?.wrongAnswer || 0) * 0.6 + Number(stats.errors?.tle || 0) * 0.9 + Number(stats.errors?.runtime || 0) * 0.7;
            const score = failureRate * 6 + Math.min(avgTimeMs / 60000, 5) + errorPressure;
            return {topic, score, attempts, solved};
        })
        .sort((left, right) => right.score - left.score);

    const weakTopics = weaknessScores.slice(0, 4).map((entry) => entry.topic);
    const fallbackTopics = ['arrays', 'strings', 'graphs', 'dynamic-programming'];
    const selectedTopics = weakTopics.length > 0 ? weakTopics : fallbackTopics;

    const recommendations = [];
    selectedTopics.forEach((topic) => {
        const matches = problemLibrary
            .filter((problem) => normalizeCategory(problem.category) === topic)
            .slice(0, 8)
            .map((problem) => ({
                id: problem.id,
                title: problem.title,
                category: problem.category,
                difficulty: problem.difficulty || 'medium',
                targetTimeComplexity: problem.targetTimeComplexity || '',
            }));
        recommendations.push({topic, problems: matches});
    });

    return {
        weakTopics: selectedTopics,
        weaknessScores,
        recommendations,
    };
};

const inferRunErrorType = ({allPassed, results = [], output = ''}) => {
    if (allPassed) return 'none';
    const outputText = `${output || ''}`.toLowerCase();
    if (outputText.includes('timed out') || outputText.includes('time limit')) return 'tle';
    if (outputText.includes('runtime') || outputText.includes('exception') || outputText.includes('segmentation')) return 'runtime';
    const failedVisible = (results || []).find((item) => item.visibility === 'visible' && !item.passed);
    if (failedVisible) return 'wrongAnswer';
    return 'runtime';
};

const buildCodeReview = ({code = '', complexityHint, runSummary = {}}) => {
    const lines = `${code}`.split('\n');
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
    const longLines = nonEmptyLines.filter((line) => line.length > 110).length;
    const commentLines = nonEmptyLines.filter((line) => /^\s*(\/\/|#|\/\*)/.test(line)).length;
    const readabilityScore = Math.max(40, 100 - longLines * 5 + Math.min(commentLines * 2, 12));

    const correctnessScore = runSummary?.allPassed ? 92 : Math.max(45, 80 - Number(runSummary?.failedCount || 0) * 8);
    const complexityScore = complexityHint?.matchesTarget ? 90 : 65;
    const communicationScore = Math.max(45, Math.min(92, 50 + commentLines * 5));

    const positives = [];
    const improvements = [];

    if (runSummary?.allPassed) positives.push('All evaluated test cases passed.');
    if (complexityHint?.matchesTarget) positives.push('Estimated complexity aligns with problem targets.');
    if (commentLines > 0) positives.push('Code contains explanatory comments that improve interview communication.');
    if (nonEmptyLines.length > 0 && longLines === 0) positives.push('Line lengths are concise and readable.');

    if (!runSummary?.allPassed) improvements.push('Fix failing visible test cases before optimization polishing.');
    if (!complexityHint?.matchesTarget) improvements.push('Refactor loops/data structures to better match target complexity.');
    if (commentLines === 0) improvements.push('Add short intent comments for critical transitions or invariants.');
    if (longLines > 0) improvements.push('Split long lines into named helper expressions for readability.');

    return {
        scores: {
            correctness: correctnessScore,
            complexity: complexityScore,
            readability: readabilityScore,
            communication: communicationScore,
            overall: Math.round((correctnessScore + complexityScore + readabilityScore + communicationScore) / 4),
        },
        positives,
        improvements,
    };
};

const buildVisualExplainers = ({code = '', sampleInput = '', sampleOutput = ''}) => {
    const complexity = detectComplexity(code);
    const inputTokens = `${sampleInput}`.trim().split(/\s+/).filter(Boolean).slice(0, 8);
    const dryRunRows = inputTokens.map((token, index) => ({
        step: index + 1,
        token,
        stateSummary: `Process token ${token}; maintain invariant after step ${index + 1}.`,
    }));

    return {
        dryRunTable: dryRunRows,
        recursionTree: complexity.signals.recursiveCalls > 0
            ? ['root()', '├─ branch A', '└─ branch B']
            : ['No obvious recursion pattern detected.'],
        graphTraversalTimeline: /bfs|dfs|graph|queue|stack/i.test(code)
            ? ['Initialize frontier', 'Visit node', 'Push neighbors', 'Mark visited']
            : ['Graph traversal pattern not detected from current code.'],
        memoryTimeline: [
            `Estimated space: ${complexity.estimatedSpace}`,
            complexity.signals.hasHashUsage ? 'Hash-based structure grows with input size.' : 'No dominant hash-based structure detected.',
            complexity.signals.hasQueueOrStack ? 'Auxiliary queue/stack usage detected.' : 'No heavy queue/stack usage detected.',
        ],
        expectedOutputPreview: `${sampleOutput || ''}`,
    };
};

const buildFailureDebugger = ({results = [], complexityHint, output = ''}) => {
    const firstFailed = (results || []).find((item) => item.visibility === 'visible' && !item.passed);
    if (!firstFailed) {
        return {
            summary: 'No visible failed test case found. Check hidden-case assumptions and boundary handling.',
            probableCause: 'Edge-case mismatch',
            suggestions: ['Re-test with smallest and largest constraints.', 'Validate output formatting and trailing spaces.'],
        };
    }

    const expected = `${firstFailed.expected || ''}`.trim();
    const actual = `${firstFailed.actual || ''}`.trim();
    const expectedTokens = expected.split(/\s+/).filter(Boolean);
    const actualTokens = actual.split(/\s+/).filter(Boolean);
    let probableCause = 'Logic mismatch';
    if (expectedTokens.length !== actualTokens.length) {
        probableCause = 'Missing or extra output elements';
    } else if (!complexityHint?.matchesTarget) {
        probableCause = 'Likely algorithmic approach drift';
    }

    return {
        summary: `Failed visible testcase #${firstFailed.index}. Expected '${expected}' but received '${actual}'.`,
        probableCause,
        suggestions: [
            'Dry-run this exact failed case and compare state transitions against expectation.',
            'Check loop bounds, index updates, and base conditions around failure point.',
            'Add temporary debug prints for critical variables near mismatch branch.',
            `${output}`.toLowerCase().includes('time') ? 'Try reducing nested iteration depth to avoid TLE.' : 'Verify all conditional branches produce output in the correct format.',
        ],
    };
};

const normalizeEmail = (value = '') => `${value}`.trim().toLowerCase();

const createPasswordHash = (password = '') => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
};

const verifyPasswordHash = (password = '', storedValue = '') => {
    const [salt, storedHash] = `${storedValue}`.split(':');
    if (!salt || !storedHash) {
        return false;
    }

    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const left = Buffer.from(passwordHash, 'hex');
    const right = Buffer.from(storedHash, 'hex');

    if (left.length !== right.length) {
        return false;
    }

    return crypto.timingSafeEqual(left, right);
};

const hashValue = (value = '') => crypto.createHash('sha256').update(`${value}`).digest('hex');

const getPasswordResetOtp = () => `${Math.floor(100000 + Math.random() * 900000)}`;
const getPasswordResetToken = () => crypto.randomBytes(24).toString('hex');

let cachedMailer = null;

const getSmtpConfig = () => {
    const host = `${process.env.SMTP_HOST || ''}`.trim();
    const configuredPort = Number(process.env.SMTP_PORT || 587);
    const user = `${process.env.SMTP_USER || ''}`.trim();
    const pass = `${process.env.SMTP_PASS || ''}`.trim();
    const isGmail = /(^|\.)smtp\.gmail\.com$/i.test(host) || /(^|\.)gmail\.com$/i.test(host);
    const forceStartTls = `${process.env.SMTP_FORCE_STARTTLS || 'true'}`.trim().toLowerCase() !== 'false';
    const port = isGmail && forceStartTls ? 587 : configuredPort;
    const secure = port === 465;

    return {
        host,
        port,
        user,
        pass,
        secure,
        requireTLS: !secure && (forceStartTls || isGmail),
        isGmail,
    };
};

const getAuthMailer = () => {
    if (cachedMailer) {
        return cachedMailer;
    }

    if (!nodemailer) {
        return null;
    }

    const smtpConfig = getSmtpConfig();

    if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
        return null;
    }

    cachedMailer = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        requireTLS: smtpConfig.requireTLS,
        connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
        greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
        socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
        dnsTimeout: Number(process.env.SMTP_DNS_TIMEOUT_MS || 10000),
        auth: {
            user: smtpConfig.user,
            pass: smtpConfig.pass,
        },
    });

    return cachedMailer;
};

const dispatchAuthEmail = async ({to, subject, text, html}) => {
    const fromAddress = `${process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@sync-code.local'}`;
    const mailer = getAuthMailer();

    if (!mailer) {
        console.log('[auth-mail:console-delivery]', {
            to,
            subject,
            note: 'SMTP not configured; email body redacted for security.',
        });
        return {delivery: 'console'};
    }

    const smtpConfig = getSmtpConfig();
    const sendTimeoutMs = Number(process.env.SMTP_SEND_TIMEOUT_MS || 20000);

    const sendWithTimeout = async (transport) => {
        await Promise.race([
            transport.sendMail({
                from: fromAddress,
                to,
                subject,
                text,
                html,
            }),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('SMTP send timed out. Please retry.')), sendTimeoutMs);
            }),
        ]);
    };

    try {
        await sendWithTimeout(mailer);
        return {delivery: 'smtp'};
    } catch (error) {
        const errorCode = `${error && error.code ? error.code : ''}`.toUpperCase();
        const isNetworkReachabilityError = ['ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(errorCode);
        const hasValidSmtpConfig = Boolean(smtpConfig.host && smtpConfig.user && smtpConfig.pass);
        const isHostName = hasValidSmtpConfig && !net.isIP(smtpConfig.host);

        if (!isNetworkReachabilityError || !hasValidSmtpConfig || !isHostName || !nodemailer) {
            throw error;
        }

        let ipv4Addresses = [];
        try {
            ipv4Addresses = await dns.resolve4(smtpConfig.host);
        } catch (resolveError) {
            throw error;
        }

        const retryHosts = ipv4Addresses.slice(0, 2);
        const retryAttempts = [];

        retryHosts.forEach((host) => {
            retryAttempts.push({host, port: smtpConfig.port, secure: smtpConfig.secure, requireTLS: smtpConfig.requireTLS});
            if (smtpConfig.port !== 587) {
                retryAttempts.push({host, port: 587, secure: false, requireTLS: true});
            }
        });

        let lastRetryError = error;
        for (const attempt of retryAttempts) {
            try {
                const retryMailer = nodemailer.createTransport({
                    host: attempt.host,
                    port: attempt.port,
                    secure: attempt.secure,
                    requireTLS: Boolean(attempt.requireTLS),
                    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
                    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
                    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
                    dnsTimeout: Number(process.env.SMTP_DNS_TIMEOUT_MS || 10000),
                    auth: {
                        user: smtpConfig.user,
                        pass: smtpConfig.pass,
                    },
                    tls: {
                        servername: smtpConfig.host,
                    },
                });

                await sendWithTimeout(retryMailer);
                return {delivery: 'smtp'};
            } catch (retryError) {
                lastRetryError = retryError;
            }
        }

        throw lastRetryError;
    }
};

const isAuthEmailConfigured = () => {
    const smtpHost = `${process.env.SMTP_HOST || ''}`.trim();
    const smtpUser = `${process.env.SMTP_USER || ''}`.trim();
    const smtpPass = `${process.env.SMTP_PASS || ''}`.trim();
    return Boolean(nodemailer && smtpHost && smtpUser && smtpPass);
};

const loadUsers = () => {
    try {
        ensurePersistenceStore();
        const rawValue = fs.readFileSync(USERS_FILE, 'utf8');
        const parsedValue = JSON.parse(rawValue || '[]');
        return Array.isArray(parsedValue) ? parsedValue : [];
    } catch (error) {
        return [];
    }
};

const persistUsers = (users = []) => {
    ensurePersistenceStore();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

const toPublicUser = (userRecord = {}) => ({
    uid: userRecord.uid,
    email: userRecord.email,
    displayName: userRecord.displayName,
    phoneNumber: '',
    photoURL: '',
});

const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];
const VALID_CATEGORIES = [
    'arrays',
    'strings',
    'math',
    'dynamic-programming',
    'graphs',
    'binary-trees',
    'backtracking',
    'sorting',
    'searching',
    'stack',
    'queue',
    'linked-list',
    'sliding-window',
    'heap',
    'trie',
    'union-find',
    'bit-manipulation',
    'matrix',
    'greedy',
    'hashing',
    'binary-search',
    'divide-conquer',
    'recursion',
    'other',
];

const CATEGORY_ALIASES = {
    dp: 'dynamic-programming',
    'dynamic-programing': 'dynamic-programming',
    graph: 'graphs',
    tree: 'binary-trees',
    'binary-tree': 'binary-trees',
    'binary tree': 'binary-trees',
    'linkedlist': 'linked-list',
    linkedlist: 'linked-list',
    'linked list': 'linked-list',
    'sliding window': 'sliding-window',
    heapq: 'heap',
    hashmap: 'hashing',
    'bit manipulation': 'bit-manipulation',
    'union find': 'union-find',
};

const normalizeCategory = (value = '') => {
    const base = `${value}`.toLowerCase().trim();
    if (!base) {
        return 'other';
    }

    const canonical = CATEGORY_ALIASES[base] || CATEGORY_ALIASES[base.replace(/\s+/g, '-')] || base;
    return VALID_CATEGORIES.includes(canonical) ? canonical : 'other';
};

const normalizeProblemRecord = (record = {}) => ({
    id: `${record.id || ''}`.trim() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: `${record.title || ''}`,
    difficulty: VALID_DIFFICULTIES.includes(`${record.difficulty || ''}`.toLowerCase()) ? `${record.difficulty}`.toLowerCase() : 'medium',
    category: normalizeCategory(record.category),
    tags: Array.isArray(record.tags) ? record.tags.map((t) => `${t}`.toLowerCase().trim()).filter(Boolean) : [],
    statement: `${record.statement || ''}`,
    targetTimeComplexity: `${record.targetTimeComplexity || ''}`,
    targetSpaceComplexity: `${record.targetSpaceComplexity || ''}`,
    timeLimitMs: Number(record.timeLimitMs) || 2000,
    memoryLimitKb: Number(record.memoryLimitKb) || 131072,
    timerDurationSeconds: Number(record.timerDurationSeconds) || 1800,
    visibleTestCases: Array.isArray(record.visibleTestCases) ? record.visibleTestCases : [],
    hiddenTestCases: Array.isArray(record.hiddenTestCases) ? record.hiddenTestCases : [],
});

const loadProblemLibrary = () => {
    try {
        ensurePersistenceStore();
        const rawValue = fs.readFileSync(PROBLEM_LIBRARY_FILE, 'utf8');
        const parsedValue = JSON.parse(rawValue || '[]');

        if (!Array.isArray(parsedValue)) {
            return defaultProblemLibrary;
        }

        return parsedValue.map((item) => normalizeProblemRecord(item));
    } catch (error) {
        return defaultProblemLibrary;
    }
};

const persistProblemLibrary = (problemLibrary) => {
    ensurePersistenceStore();
    fs.writeFileSync(PROBLEM_LIBRARY_FILE, JSON.stringify(problemLibrary, null, 2));
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const resolveJudgeLimits = ({language, roomProblem, timeLimitMs, memoryLimitKb}) => {
    const profile = judgeLanguageProfiles[language] || {
        defaultTimeLimitMs: 2000,
        defaultMemoryLimitKb: 131072,
        maxTimeLimitMs: 8000,
        maxMemoryLimitKb: 524288,
    };

    const requestedTimeLimit = Number(timeLimitMs || roomProblem?.timeLimitMs || profile.defaultTimeLimitMs);
    const requestedMemoryLimit = Number(memoryLimitKb || roomProblem?.memoryLimitKb || profile.defaultMemoryLimitKb);

    return {
        profile,
        timeLimitMs: clamp(requestedTimeLimit, 100, profile.maxTimeLimitMs),
        memoryLimitKb: clamp(requestedMemoryLimit, 4096, profile.maxMemoryLimitKb),
    };
};

const detectComplexity = (code = '') => {
    const normalizedCode = `${code}`.toLowerCase();
    const loopMatches = normalizedCode.match(/\b(for|while)\b/g) || [];
    const nestedLoopPattern = /(for|while)[\s\S]{0,240}(for|while)[\s\S]{0,240}(for|while)/g;
    const hasTripleNestedLoop = nestedLoopPattern.test(normalizedCode);
    const hasDoubleNestedLoop = /(for|while)[\s\S]{0,180}(for|while)/g.test(normalizedCode);
    const hasSorting = /\b(sort|sorted|quicksort|mergesort|heapsort)\b/.test(normalizedCode);
    const hasHashUsage = /\b(map|unordered_map|dictionary|dict|set|hash)\b/.test(normalizedCode);
    const hasQueueOrStack = /\b(queue|stack|deque)\b/.test(normalizedCode);
    const recursiveCalls = (normalizedCode.match(/\breturn\s+\w+\s*\(/g) || []).length;

    let estimatedTime = 'O(1)';
    if (hasTripleNestedLoop) {
        estimatedTime = 'O(n^3)';
    } else if (hasDoubleNestedLoop) {
        estimatedTime = 'O(n^2)';
    } else if (hasSorting) {
        estimatedTime = 'O(n log n)';
    } else if (loopMatches.length > 0 || recursiveCalls > 0) {
        estimatedTime = 'O(n)';
    }

    let estimatedSpace = 'O(1)';
    if (hasHashUsage || hasQueueOrStack) {
        estimatedSpace = 'O(n)';
    }

    return {
        estimatedTime,
        estimatedSpace,
        signals: {
            loopCount: loopMatches.length,
            hasDoubleNestedLoop,
            hasTripleNestedLoop,
            hasSorting,
            hasHashUsage,
            hasQueueOrStack,
            recursiveCalls,
        },
    };
};

const normalizeComplexityText = (value = '') => `${value}`.toLowerCase().replace(/\s+/g, '');

const generateComplexityHint = ({code, targetTimeComplexity, targetSpaceComplexity}) => {
    const analysis = detectComplexity(code);
    const targetTime = normalizeComplexityText(targetTimeComplexity);
    const targetSpace = normalizeComplexityText(targetSpaceComplexity);
    const estimatedTime = normalizeComplexityText(analysis.estimatedTime);
    const estimatedSpace = normalizeComplexityText(analysis.estimatedSpace);

    const notes = [];
    if (targetTime && estimatedTime && targetTime !== estimatedTime) {
        notes.push(`Estimated time ${analysis.estimatedTime} differs from target ${targetTimeComplexity}.`);
    }
    if (targetSpace && estimatedSpace && targetSpace !== estimatedSpace) {
        notes.push(`Estimated space ${analysis.estimatedSpace} differs from target ${targetSpaceComplexity}.`);
    }
    if (analysis.signals.hasDoubleNestedLoop) {
        notes.push('Nested loops detected; consider reducing repeated scans.');
    }
    if (analysis.signals.hasHashUsage) {
        notes.push('Hash-based structures detected; this likely increases memory usage to O(n).');
    }

    return {
        estimatedTime: analysis.estimatedTime,
        estimatedSpace: analysis.estimatedSpace,
        matchesTarget: notes.length === 0,
        notes: notes.length > 0 ? notes : ['Estimated complexity aligns with the provided target.'],
    };
};

const inferProblemCategory = (problem = {}) => {
    const explicitCategory = normalizeCategory(problem.category);
    if (explicitCategory !== 'other') {
        return explicitCategory;
    }

    const text = `${problem.title || ''} ${problem.statement || ''}`.toLowerCase();
    if (/graph|bfs|dfs|dijkstra|mst/.test(text)) return 'graphs';
    if (/tree|binary tree|bst/.test(text)) return 'binary-trees';
    if (/window|substring/.test(text)) return 'sliding-window';
    if (/stack|parentheses/.test(text)) return 'stack';
    if (/queue/.test(text)) return 'queue';
    if (/dp|dynamic programming|knapsack|memo/.test(text)) return 'dynamic-programming';
    if (/sort|merge|quick|heap/.test(text)) return 'sorting';
    if (/search|binary search/.test(text)) return 'searching';
    if (/array/.test(text)) return 'arrays';
    if (/string/.test(text)) return 'strings';
    return 'other';
};

const categoryHintMap = {
    arrays: 'Think about a linear pass first; can prefix sums or two pointers remove nested loops?',
    strings: 'Track character positions/frequencies and consider sliding window before brute-force substrings.',
    'dynamic-programming': 'Define state clearly: what does dp[i] (or dp[i][j]) represent and how is it transitioned?',
    graphs: 'Decide traversal based on graph type: BFS for shortest steps in unweighted graphs, DFS for structure exploration.',
    'binary-trees': 'Start by defining what result each recursive call should return for a subtree.',
    backtracking: 'Model this as choose → explore → un-choose; prune invalid branches as early as possible.',
    'linked-list': 'Use slow/fast pointers or sentinel nodes to simplify pointer-edge cases.',
    stack: 'Use a monotonic stack or balancing stack depending on whether order constraints exist.',
    queue: 'If order by time/layers matters, queue-based level processing is usually the simplest path.',
    'sliding-window': 'Maintain a valid window invariant and adjust left/right pointers without re-scanning.',
    sorting: 'Ask whether sorting once enables linear-time post-processing.',
    searching: 'Binary search can apply on answer space too, not only on sorted arrays.',
    greedy: 'Prove a local optimal choice can be extended globally; if not, switch to DP.',
    hashing: 'Use hash maps/sets to trade memory for faster lookup and duplicate detection.',
    heap: 'Use a heap when you repeatedly need current min/max under dynamic inserts/removals.',
    trie: 'Store prefixes explicitly when repeated prefix queries dominate runtime.',
    'union-find': 'Use disjoint-set union for connectivity queries and component merging.',
    'bit-manipulation': 'Look for parity, toggling, mask checks, and operations that collapse to bit tricks.',
    matrix: 'Treat rows/cols as graph moves or use direction vectors for traversal consistency.',
    math: 'Simplify with invariants and formulas before implementing simulation-heavy logic.',
    other: 'Start with constraints and build the smallest correct approach before optimizing.',
};

const buildEdgeCaseHint = (problem = {}) => {
    const visible = parseTestCases(problem.visibleTestCasesText || '[]');
    if (!Array.isArray(visible) || visible.length === 0) {
        return 'Check edge cases: empty input, minimum size input, duplicate values, and strictly increasing/decreasing patterns.';
    }

    const sample = visible[0] || {};
    const sampleInput = `${sample.input || ''}`.trim();
    const sampleOutput = `${sample.output || ''}`.trim();
    if (!sampleInput && !sampleOutput) {
        return 'Validate parsing logic and output format exactly; many wrong answers are formatting issues.';
    }

    return `Dry-run your code on visible case #1 and verify each step reaches output '${sampleOutput || 'expected'}'.`;
};

const buildHintLadder = ({problem = {}, code = ''}) => {
    const category = inferProblemCategory(problem);
    const complexityHint = generateComplexityHint({
        code,
        targetTimeComplexity: problem.targetTimeComplexity,
        targetSpaceComplexity: problem.targetSpaceComplexity,
    });

    const targetTime = problem.targetTimeComplexity || 'the target time complexity';
    const targetSpace = problem.targetSpaceComplexity || 'the target space complexity';

    const conceptualHint = categoryHintMap[category] || categoryHintMap.other;
    const approachHint = complexityHint.matchesTarget
        ? `Your current structure already aligns well with targets (${targetTime}, ${targetSpace}). Focus on corner-case correctness.`
        : `Refine your approach toward ${targetTime} and ${targetSpace}; avoid extra nested scans and unnecessary auxiliary structures.`;
    const edgeCaseHint = buildEdgeCaseHint(problem);
    const pseudocodeHint = 'Plan in 4 steps: parse input → initialize core data structure/state → single traversal with invariant updates → print exact output format.';

    return [
        {level: 1, title: 'Concept', message: conceptualHint},
        {level: 2, title: 'Approach', message: approachHint},
        {level: 3, title: 'Edge Cases', message: edgeCaseHint},
        {level: 4, title: 'Pseudocode', message: pseudocodeHint},
    ];
};

const loadPersistedRoomStates = () => {
    try {
        ensurePersistenceStore();
        const rawValue = fs.readFileSync(ROOM_STATE_FILE, 'utf8');
        const parsedValue = JSON.parse(rawValue || '{}');

        return Object.entries(parsedValue).reduce((accumulator, [roomId, roomState]) => {
            accumulator[roomId] = mergeRoomState(createDefaultRoomState(), roomState || {});
            return accumulator;
        }, {});
    } catch (error) {
        return {};
    }
};

const persistRoomStates = (roomStates) => {
    ensurePersistenceStore();
    fs.writeFileSync(ROOM_STATE_FILE, JSON.stringify(roomStates, null, 2));
};

const normalize = (value = '') => `${value}`.replace(/\r\n/g, '\n').trim();

const parseTestCases = (value) => {
    if (!value || !`${value}`.trim()) {
        return [];
    }

    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        throw new Error('Test cases must be a JSON array.');
    }

    return parsed.map((item) => ({
        input: item?.input ?? '',
        output: item?.output ?? '',
    }));
};

const resolveExecutionOutput = (runResult = {}) => {
    const stdoutValue = `${runResult?.output ?? ''}`;
    if (stdoutValue.length > 0) {
        return stdoutValue;
    }
    return `${runResult?.stderr ?? ''}`;
};

const execFileAsync = (file, args, options = {}) => new Promise((resolve, reject) => {
    const {
        cwd,
        timeout = 0,
        maxBuffer = 1024 * 1024,
        input = '',
    } = options;

    const child = spawn(file, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let exceededBuffer = false;

    const timeoutHandle = timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeout)
        : null;

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (Buffer.byteLength(stdout, 'utf8') > maxBuffer) {
            exceededBuffer = true;
            child.kill('SIGKILL');
        }
    });

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (Buffer.byteLength(stderr, 'utf8') > maxBuffer) {
            exceededBuffer = true;
            child.kill('SIGKILL');
        }
    });

    child.on('error', (error) => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        reject(error);
    });

    child.on('close', (code) => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }

        if (timedOut) {
            resolve({stdout, stderr: stderr || 'Execution timed out.', code: 124});
            return;
        }

        if (exceededBuffer) {
            resolve({stdout, stderr: stderr || 'Execution output exceeded buffer limits.', code: 125});
            return;
        }

        resolve({stdout, stderr, code: typeof code === 'number' ? code : 1});
    });

    if (input) {
        child.stdin.write(input);
    }
    child.stdin.end();
});

const cleanupTempDir = (tempDirPath) => {
    if (!tempDirPath) {
        return;
    }

    try {
        fs.rmSync(tempDirPath, {recursive: true, force: true});
    } catch (error) {
    }
};

const runLocalProgram = async ({command, args, code, extension, stdin = '', timeoutMs = 2000}) => {
    const tempDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-code-'));
    const sourcePath = path.join(tempDirPath, `main.${extension}`);

    try {
        fs.writeFileSync(sourcePath, code, 'utf8');
        const startedAt = Date.now();
        const {stdout, stderr, code: exitCode} = await execFileAsync(command, [...args, sourcePath], {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
            input: stdin,
        });
        const elapsedSeconds = (Date.now() - startedAt) / 1000;

        return {
            run: {
                output: stdout,
                stderr,
                code: exitCode,
                time: Number(elapsedSeconds.toFixed(3)),
                memory: null,
            },
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            throw new Error(`Local execution requires '${command}' to be installed.`);
        }
        throw error;
    } finally {
        cleanupTempDir(tempDirPath);
    }
};

const runLocalCompiledProgram = async ({
    code,
    sourceFileName,
    compileCommand,
    compileArgs,
    runCommand,
    runArgs,
    stdin = '',
    timeoutMs = 2000,
}) => {
    const tempDirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-code-'));
    const sourcePath = path.join(tempDirPath, sourceFileName);

    try {
        fs.writeFileSync(sourcePath, code, 'utf8');

        const compileResult = await execFileAsync(compileCommand, compileArgs(tempDirPath, sourcePath), {
            timeout: Math.max(timeoutMs * 2, 8000),
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
        });

        if (compileResult.code !== 0) {
            return {
                run: {
                    output: '',
                    stderr: compileResult.stderr || compileResult.stdout || 'Compilation failed.',
                    code: compileResult.code,
                    time: 0,
                    memory: null,
                },
            };
        }

        const startedAt = Date.now();
        const resolvedRunCommand = typeof runCommand === 'function'
            ? runCommand(tempDirPath, sourcePath)
            : runCommand;
        const executionResult = await execFileAsync(resolvedRunCommand, runArgs(tempDirPath, sourcePath), {
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
            input: stdin,
        });
        const elapsedSeconds = (Date.now() - startedAt) / 1000;

        return {
            run: {
                output: executionResult.stdout,
                stderr: executionResult.stderr,
                code: executionResult.code,
                time: Number(elapsedSeconds.toFixed(3)),
                memory: null,
            },
        };
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            const runCommandName = typeof runCommand === 'function' ? 'runtime binary' : runCommand;
            throw new Error(`Local execution requires '${compileCommand}' and '${runCommandName}' to be installed.`);
        }
        throw error;
    } finally {
        cleanupTempDir(tempDirPath);
    }
};

const executeLocally = async ({language, code, stdin, timeLimitMs}) => {
    if (language === 'python') {
        return runLocalProgram({
            command: 'python3',
            args: [],
            code,
            extension: 'py',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'javascript') {
        return runLocalProgram({
            command: 'node',
            args: [],
            code,
            extension: 'js',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'bash') {
        return runLocalProgram({
            command: 'bash',
            args: [],
            code,
            extension: 'sh',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'cpp') {
        return runLocalCompiledProgram({
            code,
            sourceFileName: 'main.cpp',
            compileCommand: 'c++',
            compileArgs: (tempDirPath, sourcePath) => [sourcePath, '-std=c++17', '-O2', '-o', path.join(tempDirPath, 'main.out')],
            runCommand: (tempDirPath) => path.join(tempDirPath, 'main.out'),
            runArgs: () => [],
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'java') {
        return runLocalCompiledProgram({
            code,
            sourceFileName: 'Main.java',
            compileCommand: 'javac',
            compileArgs: (_tempDirPath, sourcePath) => [sourcePath],
            runCommand: 'java',
            runArgs: (tempDirPath) => ['-cp', tempDirPath, 'Main'],
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'php') {
        return runLocalProgram({
            command: 'php',
            args: [],
            code,
            extension: 'php',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'go') {
        return runLocalProgram({
            command: 'go',
            args: ['run'],
            code,
            extension: 'go',
            stdin,
            timeoutMs: Math.max(timeLimitMs, 5000),
        });
    }

    if (language === 'r') {
        return runLocalProgram({
            command: 'Rscript',
            args: [],
            code,
            extension: 'R',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'ruby') {
        return runLocalProgram({
            command: 'ruby',
            args: [],
            code,
            extension: 'rb',
            stdin,
            timeoutMs: timeLimitMs,
        });
    }

    if (language === 'swift') {
        return runLocalProgram({
            command: 'swift',
            args: [],
            code,
            extension: 'swift',
            stdin,
            timeoutMs: Math.max(timeLimitMs, 5000),
        });
    }

    if (language === 'rust') {
        return runLocalCompiledProgram({
            code,
            sourceFileName: 'main.rs',
            compileCommand: 'rustc',
            compileArgs: (tempDirPath, sourcePath) => [sourcePath, '-O', '-o', path.join(tempDirPath, 'main.out')],
            runCommand: (tempDirPath) => path.join(tempDirPath, 'main.out'),
            runArgs: () => [],
            stdin,
            timeoutMs: Math.max(timeLimitMs, 5000),
        });
    }

    throw new Error(`Local execution fallback is not configured for '${language}'.`);
};

app.post('/api/rooms/create', (req, res) => {
    try {
        const {roomId = ''} = req.body || {};
        const normalizedRoomId = `${roomId}`.trim();

        if (!normalizedRoomId) {
            return res.status(400).json({error: 'roomId is required.'});
        }

        if (!roomStateMap[normalizedRoomId]) {
            roomStateMap[normalizedRoomId] = createDefaultRoomState();
            persistRoomStates(roomStateMap);
        }

        return res.status(200).json({roomId: normalizedRoomId, exists: true});
    } catch (error) {
        return res.status(500).json({error: 'Failed to create room.'});
    }
});

app.get('/api/rooms/:roomId/exists', (req, res) => {
    try {
        const roomId = `${req.params.roomId || ''}`.trim();
        if (!roomId) {
            return res.status(400).json({error: 'roomId is required.'});
        }

        return res.status(200).json({exists: Boolean(roomStateMap[roomId])});
    } catch (error) {
        return res.status(500).json({error: 'Failed to check room existence.'});
    }
});

app.get('/api/problems', (req, res) => {
    try {
        const {search = '', difficulty = '', category = '', page = '1', limit = '50'} = req.query;
        let problems = loadProblemLibrary();

        // server-side filtering
        const searchLower = `${search}`.toLowerCase().trim();
        if (searchLower) {
            problems = problems.filter((p) => {
                const haystack = `${p.title} ${p.statement} ${(p.tags || []).join(' ')}`.toLowerCase();
                return haystack.includes(searchLower);
            });
        }
        if (difficulty) {
            problems = problems.filter((p) => p.difficulty === difficulty.toLowerCase());
        }
        if (category) {
            problems = problems.filter((p) => p.category === category.toLowerCase());
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
        const totalCount = problems.length;
        const totalPages = Math.ceil(totalCount / limitNum) || 1;
        const offset = (pageNum - 1) * limitNum;
        const paginated = problems.slice(offset, offset + limitNum);

        return res.status(200).json({
            problems: paginated.map((problem) => ({
                id: problem.id,
                title: problem.title,
                difficulty: problem.difficulty || 'medium',
                category: problem.category || 'other',
                tags: problem.tags || [],
                targetTimeComplexity: problem.targetTimeComplexity,
                targetSpaceComplexity: problem.targetSpaceComplexity,
            })),
            pagination: {page: pageNum, limit: limitNum, totalCount, totalPages},
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to load problem library.',
        });
    }
});

app.get('/api/problems/:problemId', (req, res) => {
    try {
        if (`${req.params.problemId || ''}`.trim().toLowerCase() === 'meta') {
            const problemLibrary = loadProblemLibrary();
            const categories = [...new Set(problemLibrary.map((p) => p.category || 'other'))].sort();
            const counts = {easy: 0, medium: 0, hard: 0};
            for (const p of problemLibrary) {
                if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
            }
            return res.status(200).json({totalCount: problemLibrary.length, categories, counts});
        }

        const problemLibrary = loadProblemLibrary();
        const selected = problemLibrary.find((item) => item.id === req.params.problemId);
        if (!selected) {
            return res.status(404).json({error: 'Problem not found.'});
        }

        return res.status(200).json({problem: selected});
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to fetch selected problem.',
        });
    }
});

app.post('/api/problems', (req, res) => {
    try {
        const problemLibrary = loadProblemLibrary();
        const newProblem = normalizeProblemRecord(req.body || {});

        if (!newProblem.title.trim() || !newProblem.statement.trim()) {
            return res.status(400).json({
                error: 'Problem title and statement are required.',
            });
        }

        const exists = problemLibrary.some((item) => item.id === newProblem.id);
        if (exists) {
            return res.status(400).json({
                error: 'Problem ID already exists. Use a unique id.',
            });
        }

        const nextLibrary = [newProblem, ...problemLibrary];
        persistProblemLibrary(nextLibrary);
        return res.status(201).json({problem: newProblem});
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to save problem to library.',
        });
    }
});

app.post('/api/problems/bulk', (req, res) => {
    try {
        const incoming = req.body;
        if (!Array.isArray(incoming) || incoming.length === 0) {
            return res.status(400).json({error: 'Body must be a non-empty JSON array of problems.'});
        }
        const problemLibrary = loadProblemLibrary();
        const existingIds = new Set(problemLibrary.map((p) => p.id));
        const added = [];
        const skipped = [];

        for (const raw of incoming) {
            const problem = normalizeProblemRecord(raw);
            if (!problem.title.trim() || !problem.statement.trim()) {
                skipped.push({id: problem.id, reason: 'Missing title or statement'});
                continue;
            }
            if (existingIds.has(problem.id)) {
                skipped.push({id: problem.id, reason: 'ID already exists'});
                continue;
            }
            added.push(problem);
            existingIds.add(problem.id);
        }

        if (added.length > 0) {
            persistProblemLibrary([...added, ...problemLibrary]);
        }

        return res.status(200).json({added: added.length, skipped});
    } catch (error) {
        return res.status(500).json({error: 'Failed to bulk-import problems.'});
    }
});

app.get('/api/problems/meta', (req, res) => {
    try {
        const problemLibrary = loadProblemLibrary();
        const categories = [...new Set(problemLibrary.map((p) => p.category || 'other'))].sort();
        const counts = {easy: 0, medium: 0, hard: 0};
        for (const p of problemLibrary) {
            if (counts[p.difficulty] !== undefined) counts[p.difficulty]++;
        }
        return res.status(200).json({totalCount: problemLibrary.length, categories, counts});
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch library metadata.'});
    }
});

app.get('/api/runtime-status', (_req, res) => {
    try {
        return res.status(200).json({
            languageStatus: getRuntimeStatusByEditorLanguage(),
        });
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to fetch runtime status.',
        });
    }
});

app.post('/api/auth/signup', (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = `${req.body?.password || ''}`;
        const displayName = `${req.body?.displayName || ''}`.trim() || email.split('@')[0] || 'User';

        if (!email || !password) {
            return res.status(400).json({error: 'Email and password are required.'});
        }

        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({error: 'Enter a valid email address.'});
        }

        if (password.length < 6) {
            return res.status(400).json({error: 'Password must be at least 6 characters.'});
        }

        const users = loadUsers();
        if (users.some((user) => normalizeEmail(user.email) === email)) {
            return res.status(409).json({error: 'An account with this email already exists.'});
        }

        const newUser = {
            uid: `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            email,
            displayName,
            passwordHash: createPasswordHash(password),
            createdAt: new Date().toISOString(),
        };

        users.push(newUser);
        persistUsers(users);

        return res.status(201).json({
            user: toPublicUser(newUser),
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to create account.'});
    }
});

app.post('/api/auth/login', (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const password = `${req.body?.password || ''}`;

        if (!email || !password) {
            return res.status(400).json({error: 'Email and password are required.'});
        }

        const users = loadUsers();
        const user = users.find((record) => normalizeEmail(record.email) === email);
        if (!user || !verifyPasswordHash(password, user.passwordHash)) {
            return res.status(401).json({error: 'Invalid email or password.'});
        }

        return res.status(200).json({
            user: toPublicUser(user),
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to sign in.'});
    }
});

app.post('/api/auth/change-password', (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const oldPassword = `${req.body?.oldPassword || ''}`;
        const newPassword = `${req.body?.newPassword || ''}`;

        if (!email || !oldPassword || !newPassword) {
            return res.status(400).json({error: 'Email, old password, and new password are required.'});
        }

        if (newPassword.length < 6) {
            return res.status(400).json({error: 'New password must be at least 6 characters.'});
        }

        if (oldPassword === newPassword) {
            return res.status(400).json({error: 'New password must be different from old password.'});
        }

        const users = loadUsers();
        const userIndex = users.findIndex((record) => normalizeEmail(record.email) === email);
        if (userIndex < 0) {
            return res.status(404).json({error: 'Account not found for this email.'});
        }

        const user = users[userIndex];
        if (!verifyPasswordHash(oldPassword, user.passwordHash)) {
            return res.status(401).json({error: 'Old password is incorrect.'});
        }

        users[userIndex] = {
            ...user,
            passwordHash: createPasswordHash(newPassword),
            passwordReset: null,
        };
        persistUsers(users);

        return res.status(200).json({message: 'Password changed successfully.'});
    } catch (error) {
        return res.status(500).json({error: 'Failed to change password.'});
    }
});

app.post('/api/auth/forgot-password/request', async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const requestedMethod = `${req.body?.method || 'both'}`.trim().toLowerCase();
        const method = ['otp', 'link', 'both'].includes(requestedMethod) ? requestedMethod : 'both';
        if (!email) {
            return res.status(400).json({error: 'Email is required.'});
        }

        const users = loadUsers();
        const userIndex = users.findIndex((record) => normalizeEmail(record.email) === email);
        const user = userIndex >= 0 ? users[userIndex] : null;

        if (!user) {
            return res.status(200).json({
                message: 'If this email is registered, recovery instructions have been sent.',
            });
        }

        const shouldSendOtp = method === 'otp' || method === 'both';
        const shouldSendLink = method === 'link' || method === 'both';

        const otp = shouldSendOtp ? getPasswordResetOtp() : '';
        const resetToken = shouldSendLink ? getPasswordResetToken() : '';
        const expiresAt = Date.now() + (15 * 60 * 1000);
        const appBaseUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}`.trim();
        const resetLink = shouldSendLink
            ? `${appBaseUrl}/?resetToken=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`
            : '';

        users[userIndex] = {
            ...user,
            passwordReset: {
                otpHash: shouldSendOtp ? hashValue(otp) : null,
                tokenHash: shouldSendLink ? hashValue(resetToken) : null,
                expiresAt,
                attempts: 0,
                requestedAt: new Date().toISOString(),
            },
        };
        persistUsers(users);

        const textLines = [
            'You requested to reset your Sync Code account password.',
        ];

        const htmlLines = [
            '<p>You requested to reset your Sync Code account password.</p>',
        ];

        if (shouldSendOtp) {
            textLines.push(`OTP: ${otp}`);
            htmlLines.push(`<p><strong>OTP:</strong> ${otp}</p>`);
        }

        if (shouldSendLink) {
            textLines.push(`Reset Link: ${resetLink}`);
            htmlLines.push(`<p><a href="${resetLink}">Create a new password</a></p>`);
        }

        textLines.push('This OTP/link expires in 15 minutes.');
        htmlLines.push('<p>This OTP/link expires in 15 minutes.</p>');

        const emailDispatch = await dispatchAuthEmail({
            to: email,
            subject: 'Sync Code Password Recovery',
            text: textLines.join('\n'),
            html: htmlLines.join(''),
        });

        const responsePayload = {
            method,
            delivery: emailDispatch.delivery,
            message: emailDispatch.delivery === 'smtp'
                ? (method === 'otp'
                    ? 'Recovery OTP has been sent to your registered email.'
                    : method === 'link'
                        ? 'Password reset link has been sent to your registered email.'
                        : 'Recovery OTP and password reset link have been sent to your registered email.')
                : 'Email service is not configured. Recovery details were generated on server console only.',
        };

        if (`${process.env.AUTH_EXPOSE_RECOVERY_DEBUG || ''}`.toLowerCase() === 'true') {
            responsePayload.debug = {
                ...(shouldSendOtp ? {otp} : {}),
                ...(shouldSendLink ? {resetToken, resetLink} : {}),
            };
        }

        return res.status(200).json(responsePayload);
    } catch (error) {
        return res.status(500).json({error: error.message || 'Failed to start password recovery flow.'});
    }
});

app.post('/api/auth/forgot-password/reset', (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const otp = `${req.body?.otp || ''}`.trim();
        const resetToken = `${req.body?.resetToken || ''}`.trim();
        const newPassword = `${req.body?.newPassword || ''}`;

        if (!email) {
            return res.status(400).json({error: 'Email is required.'});
        }

        if (newPassword.length < 6) {
            return res.status(400).json({error: 'New password must be at least 6 characters.'});
        }

        if (!otp && !resetToken) {
            return res.status(400).json({error: 'Provide OTP or reset token to continue.'});
        }

        const users = loadUsers();
        const userIndex = users.findIndex((record) => normalizeEmail(record.email) === email);
        if (userIndex < 0) {
            return res.status(404).json({error: 'Account not found for this email.'});
        }

        const user = users[userIndex];
        const recovery = user.passwordReset;
        if (!recovery) {
            return res.status(400).json({error: 'No active reset request found for this account.'});
        }

        if (Date.now() > Number(recovery.expiresAt || 0)) {
            users[userIndex] = {
                ...user,
                passwordReset: null,
            };
            persistUsers(users);
            return res.status(400).json({error: 'OTP/reset link has expired. Request a new one.'});
        }

        let verified = false;
        if (otp && recovery.otpHash === hashValue(otp)) {
            verified = true;
        }
        if (!verified && resetToken && recovery.tokenHash === hashValue(resetToken)) {
            verified = true;
        }

        if (!verified) {
            const nextAttempts = Number(recovery.attempts || 0) + 1;
            users[userIndex] = {
                ...user,
                passwordReset: {
                    ...recovery,
                    attempts: nextAttempts,
                },
            };
            persistUsers(users);
            return res.status(400).json({error: 'Invalid OTP or reset token.'});
        }

        users[userIndex] = {
            ...user,
            passwordHash: createPasswordHash(newPassword),
            passwordReset: null,
        };
        persistUsers(users);

        return res.status(200).json({
            message: 'Password updated successfully. You can now sign in with the new password.',
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to reset password.'});
    }
});

app.get('/api/auth/email-status', (_req, res) => {
    try {
        const smtpHost = `${process.env.SMTP_HOST || ''}`.trim();
        const smtpPort = `${process.env.SMTP_PORT || ''}`.trim();
        const smtpUser = `${process.env.SMTP_USER || ''}`.trim();
        const smtpPass = `${process.env.SMTP_PASS || ''}`.trim();
        const smtpFrom = `${process.env.SMTP_FROM || process.env.SMTP_USER || ''}`.trim();
        const appBaseUrl = `${process.env.APP_BASE_URL || ''}`.trim();

        const missing = [];
        if (!smtpHost) missing.push('SMTP_HOST');
        if (!smtpPort) missing.push('SMTP_PORT');
        if (!smtpUser) missing.push('SMTP_USER');
        if (!smtpPass) missing.push('SMTP_PASS');
        if (!smtpFrom) missing.push('SMTP_FROM');
        if (!appBaseUrl) missing.push('APP_BASE_URL');

        return res.status(200).json({
            configured: isAuthEmailConfigured(),
            nodemailerInstalled: Boolean(nodemailer),
            providerHost: smtpHost || null,
            from: smtpFrom || null,
            missing,
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch email status.'});
    }
});

app.post('/api/auth/test-email', async (req, res) => {
    try {
        const to = normalizeEmail(req.body?.to);
        if (!to) {
            return res.status(400).json({error: 'Recipient email is required.'});
        }

        if (!isAuthEmailConfigured()) {
            return res.status(400).json({error: 'SMTP is not configured. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM.'});
        }

        const subject = 'Sync Code SMTP Test Email';
        const sentAt = new Date().toISOString();
        const text = [
            'This is a test email from Sync Code.',
            `Sent at: ${sentAt}`,
            'If you received this, SMTP is configured correctly.',
        ].join('\n');

        const html = `
            <p>This is a test email from <strong>Sync Code</strong>.</p>
            <p><strong>Sent at:</strong> ${sentAt}</p>
            <p>If you received this, SMTP is configured correctly.</p>
        `;

        const delivery = await dispatchAuthEmail({to, subject, text, html});
        if (delivery.delivery !== 'smtp') {
            return res.status(500).json({error: 'SMTP transport failed. Email was not delivered to inbox.'});
        }

        return res.status(200).json({message: `Test email sent successfully to ${to}.`});
    } catch (error) {
        return res.status(500).json({error: error.message || 'Failed to send test email.'});
    }
});

app.get('/api/health', (_req, res) => {
    try {
        const runtimeStatus = getRuntimeStatusByEditorLanguage();
        const runtimeSummary = Object.values(runtimeStatus).reduce(
            (summary, status) => {
                if (status.localAvailable) {
                    summary.localAvailable += 1;
                } else {
                    summary.localMissing += 1;
                }
                return summary;
            },
            {localAvailable: 0, localMissing: 0}
        );

        return res.status(200).json({
            status: 'ok',
            uptimeSeconds: Math.floor((Date.now() - serverStartedAt) / 1000),
            timestamp: new Date().toISOString(),
            mode: `${process.env.EXECUTION_PROVIDER || 'auto'}`.toLowerCase(),
            allowLocalFallback: process.env.ALLOW_LOCAL_EXECUTION_FALLBACK !== 'false',
            runtimeSummary,
        });
    } catch (error) {
        return res.status(500).json({
            status: 'error',
            error: 'Failed to compute health status.',
        });
    }
});

app.post('/api/complexity-hint', (req, res) => {
    try {
        const {code = '', targetTimeComplexity = '', targetSpaceComplexity = ''} = req.body || {};
        if (!`${code}`.trim()) {
            return res.status(400).json({
                error: 'Code is required to generate complexity hints.',
            });
        }

        const hint = generateComplexityHint({code, targetTimeComplexity, targetSpaceComplexity});
        return res.status(200).json({hint});
    } catch (error) {
        return res.status(500).json({
            error: 'Failed to generate complexity hint.',
        });
    }
});

app.post('/api/problem-hints', (req, res) => {
    try {
        const {roomId = '', code = '', revealedCount = 0} = req.body || {};
        const normalizedRoomId = `${roomId}`.trim();

        if (!normalizedRoomId) {
            return res.status(400).json({error: 'roomId is required.'});
        }

        const roomState = roomStateMap[normalizedRoomId];
        if (!roomState?.problem) {
            return res.status(404).json({error: 'Room problem not found for hint generation.'});
        }

        const hints = buildHintLadder({
            problem: roomState.problem,
            code,
        });

        const nextIndex = Math.max(0, Math.min(Number(revealedCount) || 0, hints.length));
        if (nextIndex >= hints.length) {
            return res.status(200).json({
                done: true,
                totalHints: hints.length,
                nextHint: null,
                suggestedPenalty: hints.length * 5,
            });
        }

        return res.status(200).json({
            done: false,
            totalHints: hints.length,
            nextHint: hints[nextIndex],
            suggestedPenalty: (nextIndex + 1) * 5,
        });
    } catch (error) {
        return res.status(500).json({
            error: error.message || 'Failed to generate problem hints.',
        });
    }
});

app.get('/api/recommendations', (req, res) => {
    try {
        const username = `${req.query.username || ''}`.trim();
        if (!username) {
            return res.status(400).json({error: 'username is required.'});
        }

        const problemLibrary = loadProblemLibrary();
        const payload = getAdaptiveRecommendations(username, problemLibrary);
        return res.status(200).json(payload);
    } catch (error) {
        return res.status(500).json({error: 'Failed to compute recommendations.'});
    }
});

app.post('/api/code-review', (req, res) => {
    try {
        const {code = '', runSummary = {}, complexityHint = null} = req.body || {};
        if (!`${code}`.trim()) {
            return res.status(400).json({error: 'code is required.'});
        }

        const review = buildCodeReview({code, runSummary, complexityHint});
        return res.status(200).json({review});
    } catch (error) {
        return res.status(500).json({error: 'Failed to generate AI code review.'});
    }
});

app.post('/api/visual-explainers', (req, res) => {
    try {
        const {code = '', sampleInput = '', sampleOutput = ''} = req.body || {};
        if (!`${code}`.trim()) {
            return res.status(400).json({error: 'code is required.'});
        }

        const explainers = buildVisualExplainers({code, sampleInput, sampleOutput});
        return res.status(200).json({explainers});
    } catch (error) {
        return res.status(500).json({error: 'Failed to generate visual explainers.'});
    }
});

app.post('/api/debug-run-failure', (req, res) => {
    try {
        const {results = [], complexityHint = null, output = ''} = req.body || {};
        const debug = buildFailureDebugger({results, complexityHint, output});
        return res.status(200).json({debug});
    } catch (error) {
        return res.status(500).json({error: 'Failed to generate debugger insights.'});
    }
});

app.get('/api/tracks', (req, res) => {
    try {
        const tracks = loadCompanyTracks();
        const problemLibrary = loadProblemLibrary();
        const trackList = Object.entries(tracks).map(([id, track]) => {
            const totalProblems = problemLibrary.filter((problem) => (track.categories || []).includes(normalizeCategory(problem.category))).length;
            return {
                id,
                company: track.company,
                description: track.description,
                categories: track.categories,
                targetDifficulties: track.targetDifficulties,
                totalProblems,
            };
        });
        return res.status(200).json({tracks: trackList});
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch company tracks.'});
    }
});

app.get('/api/tracks/:trackId', (req, res) => {
    try {
        const trackId = `${req.params.trackId || ''}`.toLowerCase().trim();
        const tracks = loadCompanyTracks();
        const track = tracks[trackId];
        if (!track) {
            return res.status(404).json({error: 'Track not found.'});
        }

        const problemLibrary = loadProblemLibrary();
        const problems = problemLibrary
            .filter((problem) => (track.categories || []).includes(normalizeCategory(problem.category)))
            .filter((problem) => (track.targetDifficulties || []).includes((problem.difficulty || 'medium')))
            .slice(0, 80)
            .map((problem) => ({
                id: problem.id,
                title: problem.title,
                category: problem.category,
                difficulty: problem.difficulty,
                targetTimeComplexity: problem.targetTimeComplexity,
            }));

        return res.status(200).json({
            track: {
                id: trackId,
                ...track,
            },
            problems,
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch track details.'});
    }
});

app.get('/api/sheets', (req, res) => {
    try {
        const username = `${req.query.username || ''}`.trim();
        if (!username) {
            return res.status(400).json({error: 'username is required.'});
        }

        const sheetStore = loadPracticeSheets();
        const templates = sheetStore.templates || DEFAULT_SHEET_TEMPLATES;
        const userCustomSheets = (sheetStore.userSheets || {})[username] || [];
        const userCheckIns = (sheetStore.checkIns || {})[username] || {};
        const reminders = (sheetStore.reminders || {})[username] || [];

        return res.status(200).json({
            templates: Object.values(templates),
            customSheets: userCustomSheets,
            checkIns: userCheckIns,
            reminders,
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch sheets.'});
    }
});

app.post('/api/sheets/custom', (req, res) => {
    try {
        const {username = '', title = '', problemIds = []} = req.body || {};
        if (!`${username}`.trim() || !`${title}`.trim()) {
            return res.status(400).json({error: 'username and title are required.'});
        }

        const sheetStore = loadPracticeSheets();
        sheetStore.userSheets = sheetStore.userSheets || {};
        sheetStore.userSheets[username] = sheetStore.userSheets[username] || [];

        const customSheet = {
            id: `custom-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            title: `${title}`.trim(),
            description: 'User-defined collaborative practice sheet.',
            items: Array.isArray(problemIds) ? problemIds.slice(0, 300) : [],
            createdAt: new Date().toISOString(),
        };

        sheetStore.userSheets[username] = [customSheet, ...sheetStore.userSheets[username]].slice(0, 50);
        persistJsonFile(PRACTICE_SHEETS_FILE, sheetStore);
        return res.status(201).json({sheet: customSheet});
    } catch (error) {
        return res.status(500).json({error: 'Failed to create custom sheet.'});
    }
});

app.post('/api/sheets/checkin', (req, res) => {
    try {
        const {username = '', sheetId = '', solvedCount = 0, reminderAt = ''} = req.body || {};
        if (!`${username}`.trim() || !`${sheetId}`.trim()) {
            return res.status(400).json({error: 'username and sheetId are required.'});
        }

        const sheetStore = loadPracticeSheets();
        sheetStore.checkIns = sheetStore.checkIns || {};
        sheetStore.reminders = sheetStore.reminders || {};
        sheetStore.checkIns[username] = sheetStore.checkIns[username] || {};

        sheetStore.checkIns[username][sheetId] = {
            solvedCount: Number(solvedCount) || 0,
            updatedAt: new Date().toISOString(),
        };

        if (`${reminderAt}`.trim()) {
            const nextReminder = {
                id: `rem-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                sheetId,
                remindAt: reminderAt,
                createdAt: new Date().toISOString(),
            };
            sheetStore.reminders[username] = [nextReminder, ...(sheetStore.reminders[username] || [])].slice(0, 100);
        }

        persistJsonFile(PRACTICE_SHEETS_FILE, sheetStore);
        return res.status(200).json({checkIn: sheetStore.checkIns[username][sheetId]});
    } catch (error) {
        return res.status(500).json({error: 'Failed to update sheet check-in.'});
    }
});

app.get('/api/reminders/next', (req, res) => {
    try {
        const username = `${req.query.username || ''}`.trim();
        if (!username) {
            return res.status(400).json({error: 'username is required.'});
        }

        const sheetStore = loadPracticeSheets();
        const reminders = (sheetStore.reminders || {})[username] || [];
        const now = Date.now();
        const pending = reminders
            .filter((item) => Number(new Date(item.remindAt).getTime() || 0) >= now)
            .sort((left, right) => new Date(left.remindAt).getTime() - new Date(right.remindAt).getTime())
            .slice(0, 5);

        return res.status(200).json({reminders: pending});
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch reminders.'});
    }
});

app.get('/api/solution-notebook', (req, res) => {
    try {
        const username = `${req.query.username || ''}`.trim();
        const problemId = `${req.query.problemId || ''}`.trim();
        if (!username || !problemId) {
            return res.status(400).json({error: 'username and problemId are required.'});
        }

        const notebook = loadSolutionNotebook();
        const key = `${username}::${problemId}`;
        const versions = notebook[key] || [];
        return res.status(200).json({versions});
    } catch (error) {
        return res.status(500).json({error: 'Failed to fetch notebook versions.'});
    }
});

app.post('/api/solution-notebook', (req, res) => {
    try {
        const {username = '', problemId = '', title = '', language = '', code = '', complexity = '', note = ''} = req.body || {};
        if (!`${username}`.trim() || !`${problemId}`.trim() || !`${code}`.trim()) {
            return res.status(400).json({error: 'username, problemId, and code are required.'});
        }

        const notebook = loadSolutionNotebook();
        const key = `${username}::${problemId}`;
        notebook[key] = notebook[key] || [];

        const version = {
            id: `ver-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            versionNumber: notebook[key].length + 1,
            title: `${title}`.trim() || 'Solution Version',
            language: `${language}`.trim(),
            complexity: `${complexity}`.trim(),
            note: `${note}`.trim(),
            code,
            createdAt: new Date().toISOString(),
        };

        notebook[key] = [version, ...notebook[key]].slice(0, 100);
        persistJsonFile(SOLUTION_NOTEBOOK_FILE, notebook);
        return res.status(201).json({version});
    } catch (error) {
        return res.status(500).json({error: 'Failed to save solution version.'});
    }
});

app.get('/api/solution-notebook/compare', (req, res) => {
    try {
        const username = `${req.query.username || ''}`.trim();
        const problemId = `${req.query.problemId || ''}`.trim();
        const leftVersion = `${req.query.leftVersion || ''}`.trim();
        const rightVersion = `${req.query.rightVersion || ''}`.trim();
        if (!username || !problemId || !leftVersion || !rightVersion) {
            return res.status(400).json({error: 'username, problemId, leftVersion, and rightVersion are required.'});
        }

        const notebook = loadSolutionNotebook();
        const key = `${username}::${problemId}`;
        const versions = notebook[key] || [];
        const left = versions.find((item) => item.id === leftVersion);
        const right = versions.find((item) => item.id === rightVersion);
        if (!left || !right) {
            return res.status(404).json({error: 'Could not find both versions to compare.'});
        }

        const leftLines = `${left.code || ''}`.split('\n').length;
        const rightLines = `${right.code || ''}`.split('\n').length;

        return res.status(200).json({
            comparison: {
                left: {id: left.id, versionNumber: left.versionNumber, complexity: left.complexity, lines: leftLines},
                right: {id: right.id, versionNumber: right.versionNumber, complexity: right.complexity, lines: rightLines},
                summary: [
                    `Line delta: ${rightLines - leftLines >= 0 ? '+' : ''}${rightLines - leftLines}`,
                    `Complexity: ${left.complexity || 'N/A'} → ${right.complexity || 'N/A'}`,
                    `Notes: ${right.note || 'No note provided for latest version.'}`,
                ],
            },
        });
    } catch (error) {
        return res.status(500).json({error: 'Failed to compare solution versions.'});
    }
});

app.post('/api/run', async (req, res) => {
    try {
        const {roomId, language, code, stdin = '', visibleTestCases = [], hiddenTestCases = [], timeLimitMs, memoryLimitKb, username = ''} = req.body;

        if (!language || !code) {
            return res.status(400).json({
                error: 'Both language and code are required.',
            });
        }

        const executionLanguage = languageMap[language];
        if (!executionLanguage) {
            return res.status(400).json({
                error: `Code execution is not available for '${language}' yet.`,
            });
        }

        const roomState = roomId ? roomStateMap[roomId] : null;
        const {timeLimitMs: resolvedTimeLimitMs, memoryLimitKb: resolvedMemoryLimitKb, profile} = resolveJudgeLimits({
            language: executionLanguage,
            roomProblem: roomState?.problem,
            timeLimitMs,
            memoryLimitKb,
        });
        const resolvedHiddenTestCases = Array.isArray(hiddenTestCases) && hiddenTestCases.length > 0
            ? hiddenTestCases
            : parseTestCases(roomState?.problem?.hiddenTestCasesText || '');
        const complexityHint = generateComplexityHint({
            code,
            targetTimeComplexity: roomState?.problem?.targetTimeComplexity,
            targetSpaceComplexity: roomState?.problem?.targetSpaceComplexity,
        });

        const executeWithInput = async (inputText = '') => {
            const executionProvider = `${process.env.EXECUTION_PROVIDER || 'auto'}`.toLowerCase();
            const allowLocalFallback = process.env.ALLOW_LOCAL_EXECUTION_FALLBACK !== 'false';

            const runPistonExecution = async () => {
                const pistonResponse = await fetch('https://emkc.org/api/v2/piston/execute', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        language: executionLanguage,
                        version: '*',
                        files: [{content: code}],
                        stdin: inputText,
                        run_timeout: resolvedTimeLimitMs,
                        run_memory_limit: resolvedMemoryLimitKb,
                    }),
                });

                if (!pistonResponse.ok) {
                    throw new Error('Execution service is temporarily unavailable. Try again.');
                }

                return pistonResponse.json();
            };

            if (executionProvider === 'local') {
                return executeLocally({
                    language: executionLanguage,
                    code,
                    stdin: inputText,
                    timeLimitMs: resolvedTimeLimitMs,
                });
            }

            try {
                return await runPistonExecution();
            } catch (error) {
                if (!allowLocalFallback || executionProvider === 'remote') {
                    throw error;
                }

                return executeLocally({
                    language: executionLanguage,
                    code,
                    stdin: inputText,
                    timeLimitMs: resolvedTimeLimitMs,
                });
            }
        };

        const allTestCases = [
            ...visibleTestCases.map((testCase) => ({...testCase, visibility: 'visible'})),
            ...resolvedHiddenTestCases.map((testCase) => ({...testCase, visibility: 'hidden'})),
        ];

        if (!Array.isArray(allTestCases) || allTestCases.length === 0) {
            const result = await executeWithInput(stdin);
            const output = resolveExecutionOutput(result?.run) || 'No output';
            const runSummary = {
                allPassed: Boolean(result?.run?.code === 0),
                failedCount: result?.run?.code === 0 ? 0 : 1,
            };

            if (`${username}`.trim() && roomState?.problem) {
                upsertUserProgressRecord({
                    username: `${username}`.trim(),
                    category: roomState.problem.category,
                    difficulty: roomState.problem.difficulty || 'medium',
                    passed: runSummary.allPassed,
                    elapsedMs: Number((result?.run?.time || 0) * 1000),
                    errorType: runSummary.allPassed ? 'none' : inferRunErrorType({allPassed: false, results: [], output}),
                });
            }

            return res.status(200).json({
                output,
                code: result?.run?.code,
                signal: result?.run?.signal,
                executionMeta: {
                    time: result?.run?.time ? `${result.run.time}s` : 'N/A',
                    memory: result?.run?.memory ? `${result.run.memory}KB` : 'N/A',
                },
                complexityHint,
                limits: {
                    timeLimitMs: resolvedTimeLimitMs,
                    memoryLimitKb: resolvedMemoryLimitKb,
                    profile,
                },
            });
        }

        const results = [];
    let totalExecutionTime = 0;
    let peakMemory = 0;

        for (let index = 0; index < allTestCases.length; index += 1) {
            const current = allTestCases[index] || {};
            const testInput = current.input ?? '';
            const expectedOutput = current.output ?? '';

            const execution = await executeWithInput(testInput);
            const actualOutput = resolveExecutionOutput(execution?.run);
            const runTime = Number(execution?.run?.time || 0);
            const runMemory = Number(execution?.run?.memory || 0);

            totalExecutionTime += runTime;
            peakMemory = Math.max(peakMemory, runMemory);

            const passed = normalize(actualOutput) === normalize(expectedOutput);
            results.push({
                index: index + 1,
                visibility: current.visibility,
                input: current.visibility === 'visible' ? testInput : '',
                expected: current.visibility === 'visible' ? expectedOutput : '',
                actual: current.visibility === 'visible' ? actualOutput : '',
                passed,
            });
        }

        const allPassed = results.every((item) => item.passed);
        const failedCount = results.filter((item) => !item.passed).length;
        const debug = allPassed
            ? null
            : buildFailureDebugger({
                results,
                complexityHint,
                output: `Failed ${failedCount} test case(s).`,
            });

        if (`${username}`.trim() && roomState?.problem) {
            upsertUserProgressRecord({
                username: `${username}`.trim(),
                category: roomState.problem.category,
                difficulty: roomState.problem.difficulty || 'medium',
                passed: allPassed,
                elapsedMs: Math.round(totalExecutionTime * 1000),
                errorType: inferRunErrorType({allPassed, results, output: `Failed ${failedCount} test case(s).`}),
            });
        }

        return res.status(200).json({
            allPassed,
            results,
            output: allPassed
                ? 'All test cases passed.'
                : `Failed ${failedCount} test case(s).`,
            executionMeta: {
                time: totalExecutionTime > 0 ? `${totalExecutionTime.toFixed(3)}s` : 'N/A',
                memory: peakMemory > 0 ? `${peakMemory}KB` : 'N/A',
            },
            complexityHint,
            debug,
            limits: {
                timeLimitMs: resolvedTimeLimitMs,
                memoryLimitKb: resolvedMemoryLimitKb,
                profile,
            },
        });
    } catch (error) {
        return res.status(500).json({
            error: error.message || 'Failed to run code. Please try again.',
        });
    }
});

const userSocketMap = {};
const roomStateMap = loadPersistedRoomStates();
const roomSwitchRequests = {};
const roomSwitchRequestIndex = {};

const makeSwitchRequestIndexKey = (roomId, requesterSocketId) => `${roomId}:${requesterSocketId}`;

const removeSwitchRequest = (requestId) => {
    const request = roomSwitchRequests[requestId];
    if (!request) {
        return;
    }

    const indexKey = makeSwitchRequestIndexKey(request.roomId, request.requesterSocketId);
    if (roomSwitchRequestIndex[indexKey] === requestId) {
        delete roomSwitchRequestIndex[indexKey];
    }

    delete roomSwitchRequests[requestId];
};

const clearSwitchRequestsForSocket = (socketId) => {
    Object.entries(roomSwitchRequests).forEach(([requestId, request]) => {
        if (request.requesterSocketId === socketId || request.hostSocketId === socketId) {
            removeSwitchRequest(requestId);
        }
    });
};

const pickUserColorForRoom = (roomId) => {
    const connectedClients = getAllConnectedClients(roomId);
    const usedColors = new Set(connectedClients.map((client) => client.color));
    const availableColor = collaborationColorPalette.find((color) => !usedColors.has(color));

    if (availableColor) {
        return availableColor;
    }

    return collaborationColorPalette[connectedClients.length % collaborationColorPalette.length];
};

const getSocketUsername = (socketId) => userSocketMap[socketId]?.username || '';
const getRoleForUsername = (roomState, username) =>
    username === roomState.ownerUsername ? 'HOST' : 'MEMBER';

function getAllConnectedClients(roomId) {
    // Map
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => {
            const userState = userSocketMap[socketId] || {};
            return {
                socketId,
                userId: socketId,
                username: userState.username,
                color: userState.color,
                isTyping: Boolean(userState.isTyping),
                cursorPosition: userState.cursorPosition || null,
                selectionRange: userState.selectionRange || null,
                voiceEnabled: Boolean(userState.voiceEnabled),
                isOnline: true,
            };
        }
    );
}

function emitPresenceToRoom(roomId) {
    io.to(roomId).emit(ACTIONS.PRESENCE_UPDATE, {
        clients: getAllConnectedClients(roomId),
    });
}

function emitRoomStateToRoom(roomId) {
    const currentState = roomStateMap[roomId] || createDefaultRoomState();
    const clients = getAllConnectedClients(roomId);

    clients.forEach(({socketId, username}) => {
        io.to(socketId).emit(ACTIONS.ROOM_STATE_UPDATE, {
            roomState: getRoomStateForUser(currentState, username === currentState.ownerUsername),
            role: getRoleForUsername(currentState, username),
        });
    });
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on(ACTIONS.JOIN, ({roomId, username}) => {
        if (!roomId || !roomStateMap[roomId]) {
            io.to(socket.id).emit(ACTIONS.JOIN_REJECTED, {
                roomId,
                reason: 'Room does not exist. Ask host for a valid room ID or create a new room first.',
            });
            return;
        }

        userSocketMap[socket.id] = {
            username,
            color: pickUserColorForRoom(roomId),
            isTyping: false,
            cursorPosition: null,
            selectionRange: null,
            voiceEnabled: false,
        };
        socket.join(roomId);
        if (!roomStateMap[roomId].ownerUsername) {
            roomStateMap[roomId].ownerUsername = username;
            persistRoomStates(roomStateMap);
        }
        const clients = getAllConnectedClients(roomId);
        clients.forEach(({socketId}) => {
            const targetUsername = getSocketUsername(socketId);
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
                roomState: getRoomStateForUser(
                    roomStateMap[roomId],
                    targetUsername === roomStateMap[roomId].ownerUsername
                ),
                role: getRoleForUsername(roomStateMap[roomId], targetUsername),
            });
        });

        emitPresenceToRoom(roomId);
    });

    socket.on(ACTIONS.CODE_CHANGE, ({roomId, code}) => {
        roomStateMap[roomId] = roomStateMap[roomId] || createDefaultRoomState();
        roomStateMap[roomId].latestCode = code;
        persistRoomStates(roomStateMap);
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, {code});
    });

    socket.on(ACTIONS.SYNC_CODE, ({socketId, code}) => {
        const roomId = Array.from(socket.rooms).find((room) => room !== socket.id);
        const persistedCode = roomId ? roomStateMap[roomId]?.latestCode : '';
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, {code: code || persistedCode || ''});
    });

    socket.on(ACTIONS.ROOM_STATE_UPDATE, ({roomId, updates}) => {
        const existingState = roomStateMap[roomId] || createDefaultRoomState();
        const currentUsername = getSocketUsername(socket.id);
        const isOwner = currentUsername === existingState.ownerUsername;

        const safeUpdates = isOwner
            ? (updates || {})
            : {
                submissions: updates?.submissions,
            };

        roomStateMap[roomId] = mergeRoomState(existingState, safeUpdates);
        persistRoomStates(roomStateMap);
        emitRoomStateToRoom(roomId);
    });

    socket.on(ACTIONS.CURSOR_MOVE, ({roomId, cursorPosition, selectionRange}) => {
        if (!roomId || !userSocketMap[socket.id]) {
            return;
        }

        userSocketMap[socket.id].cursorPosition = cursorPosition;
        userSocketMap[socket.id].selectionRange = selectionRange || null;

        socket.in(roomId).emit(ACTIONS.CURSOR_MOVE, {
            userId: socket.id,
            username: getSocketUsername(socket.id),
            color: userSocketMap[socket.id].color,
            cursorPosition,
            selectionRange: selectionRange || null,
        });
    });

    socket.on(ACTIONS.TYPING_START, ({roomId}) => {
        if (!roomId || !userSocketMap[socket.id]) {
            return;
        }

        userSocketMap[socket.id].isTyping = true;
        emitPresenceToRoom(roomId);
    });

    socket.on(ACTIONS.TYPING_STOP, ({roomId}) => {
        if (!roomId || !userSocketMap[socket.id]) {
            return;
        }

        userSocketMap[socket.id].isTyping = false;
        emitPresenceToRoom(roomId);
    });

    socket.on(ACTIONS.SUBMISSION_ADD, ({roomId, submission}) => {
        if (!submission) {
            return;
        }

        const currentState = roomStateMap[roomId] || createDefaultRoomState();
        currentState.submissions = [submission, ...currentState.submissions].slice(0, 20);
        roomStateMap[roomId] = currentState;
        persistRoomStates(roomStateMap);
        emitRoomStateToRoom(roomId);
    });

    socket.on(ACTIONS.WHITEBOARD_SYNC, ({roomId, strokes}) => {
        if (!roomId) {
            return;
        }

        socket.in(roomId).emit(ACTIONS.WHITEBOARD_SYNC, {
            strokes: Array.isArray(strokes) ? strokes : [],
        });
    });

    socket.on(ACTIONS.WHITEBOARD_CLEAR, ({roomId}) => {
        if (!roomId) {
            return;
        }

        socket.in(roomId).emit(ACTIONS.WHITEBOARD_CLEAR);
    });

    socket.on(ACTIONS.VOICE_SIGNAL, ({toSocketId, signal}) => {
        if (!toSocketId || !signal) {
            return;
        }

        io.to(toSocketId).emit(ACTIONS.VOICE_SIGNAL, {
            fromSocketId: socket.id,
            signal,
        });
    });

    socket.on(ACTIONS.VOICE_STATUS, ({roomId, enabled}) => {
        if (!roomId || !userSocketMap[socket.id]) {
            return;
        }

        userSocketMap[socket.id].voiceEnabled = Boolean(enabled);
        emitPresenceToRoom(roomId);
    });

    socket.on(ACTIONS.HOST_SET_PROBLEM, ({roomId, problemId, title, description, testCases = {}, problem = {}}) => {
        const existingState = roomStateMap[roomId] || createDefaultRoomState();
        const currentUsername = getSocketUsername(socket.id);
        const isHost = currentUsername === existingState.ownerUsername;

        if (!isHost) {
            return;
        }

        const normalizedVisible = Array.isArray(problem.visibleTestCases)
            ? problem.visibleTestCases
            : Array.isArray(testCases.visible)
                ? testCases.visible
                : [];
        const normalizedHidden = Array.isArray(problem.hiddenTestCases)
            ? problem.hiddenTestCases
            : Array.isArray(testCases.hidden)
                ? testCases.hidden
                : [];

        roomStateMap[roomId] = mergeRoomState(existingState, {
            problem: {
                id: problemId || problem.id || '',
                title: title || problem.title || '',
                statement: description || problem.statement || '',
                targetTimeComplexity: problem.targetTimeComplexity || existingState.problem.targetTimeComplexity,
                targetSpaceComplexity: problem.targetSpaceComplexity || existingState.problem.targetSpaceComplexity,
                timeLimitMs: Number(problem.timeLimitMs) || existingState.problem.timeLimitMs,
                memoryLimitKb: Number(problem.memoryLimitKb) || existingState.problem.memoryLimitKb,
                visibleTestCasesText: JSON.stringify(normalizedVisible, null, 2),
                hiddenTestCasesText: JSON.stringify(normalizedHidden, null, 2),
            },
            timer: {
                ...existingState.timer,
                durationSeconds: Number(problem.timerDurationSeconds) || existingState.timer.durationSeconds,
                startedAt: null,
            },
        });

        persistRoomStates(roomStateMap);
        emitRoomStateToRoom(roomId);
    });

    socket.on(ACTIONS.PROBLEM_REQUEST_SWITCH, ({roomId, problemId, requesterName, title}) => {
        const currentState = roomStateMap[roomId] || createDefaultRoomState();
        const hostUsername = currentState.ownerUsername;
        const hostClient = getAllConnectedClients(roomId).find((client) => client.username === hostUsername);

        if (!hostClient || !problemId) {
            return;
        }

        const indexKey = makeSwitchRequestIndexKey(roomId, socket.id);
        const existingRequestId = roomSwitchRequestIndex[indexKey];
        if (existingRequestId && roomSwitchRequests[existingRequestId]) {
            io.to(socket.id).emit(ACTIONS.PROBLEM_SWITCH_RESPONSE, {
                requestId: existingRequestId,
                decision: 'pending',
                problemId,
                requesterName: requesterName || getSocketUsername(socket.id),
                title: title || '',
            });
            return;
        }

        const request = {
            requestId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            roomId,
            problemId,
            title: title || '',
            requesterName: requesterName || getSocketUsername(socket.id),
            requesterSocketId: socket.id,
            hostSocketId: hostClient.socketId,
            createdAt: Date.now(),
        };

        roomSwitchRequests[request.requestId] = request;
        roomSwitchRequestIndex[indexKey] = request.requestId;
        io.to(hostClient.socketId).emit(ACTIONS.PROBLEM_SWITCH_REQUESTED, request);
    });

    socket.on(ACTIONS.PROBLEM_SWITCH_RESPONSE, ({requestId, decision}) => {
        const request = roomSwitchRequests[requestId];
        if (!request) {
            return;
        }

        const currentState = roomStateMap[request.roomId] || createDefaultRoomState();
        const currentUsername = getSocketUsername(socket.id);
        const isHost = currentUsername === currentState.ownerUsername;
        if (!isHost) {
            return;
        }

        io.to(request.requesterSocketId).emit(ACTIONS.PROBLEM_SWITCH_RESPONSE, {
            requestId,
            decision: decision === 'approved' ? 'approved' : 'rejected',
            problemId: request.problemId,
            requesterName: request.requesterName,
            title: request.title,
        });

        removeSwitchRequest(requestId);
    });

    socket.on('disconnecting', () => {
        clearSwitchRequestsForSocket(socket.id);
        const rooms = [...socket.rooms];
        rooms.forEach((roomId) => {
            const currentState = roomStateMap[roomId];
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: getSocketUsername(socket.id),
            });

            const roomSize = io.sockets.adapter.rooms.get(roomId)?.size || 0;
            if (roomSize <= 1) {
                persistRoomStates(roomStateMap);
            } else if (currentState?.ownerUsername === getSocketUsername(socket.id)) {
                const nextOwner = getAllConnectedClients(roomId).find(
                    (client) => client.socketId !== socket.id
                );

                if (nextOwner) {
                    currentState.ownerUsername = nextOwner.username;
                    persistRoomStates(roomStateMap);
                    emitRoomStateToRoom(roomId);
                }
            }

            socket.in(roomId).emit(ACTIONS.PRESENCE_UPDATE, {
                clients: getAllConnectedClients(roomId).filter((client) => client.socketId !== socket.id),
            });
        });
        delete userSocketMap[socket.id];
        socket.leave();
    });
});

app.use(express.static('build'));
app.get('*', (req, res) => {
    const indexPath = path.join(__dirname, 'build', 'index.html');

    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }

    return res.status(200).send('Realtime code editor backend is running.');
});

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 5000);
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));