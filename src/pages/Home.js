import React, {useEffect, useRef, useState} from 'react';
import {v4 as uuidV4} from 'uuid';
import toast from 'react-hot-toast';
import {useNavigate} from 'react-router-dom';
import {
    EmailAuthProvider,
    RecaptchaVerifier,
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    reauthenticateWithCredential,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signInWithPhoneNumber,
    signInWithPopup,
    signOut,
    updatePassword,
} from 'firebase/auth';
import {auth, googleProvider, isFirebaseConfigured} from '../firebase';

const backendBaseUrl = process.env.REACT_APP_BACKEND_URL || window.location.origin;
const LOCAL_AUTH_STORAGE_KEY = 'sync-code-local-auth-user';
const USERNAME_PREF_STORAGE_KEY = 'sync-code-username-pref';

const trustedBy = ['Google', 'Amazon', 'Meta', 'Microsoft', 'Netflix'];
const trustedByLinks = {
    Google: 'https://careers.google.com/',
    Amazon: 'https://www.amazon.jobs/',
    Meta: 'https://www.metacareers.com/',
    Microsoft: 'https://careers.microsoft.com/',
    Netflix: 'https://jobs.netflix.com/',
};
const problemCategories = [
    'Arrays',
    'Strings',
    'Dynamic Programming',
    'Graphs',
    'Binary Trees',
    'Backtracking',
    'Linked List',
    'Stack',
    'Queue',
    'Sliding Window',
    'Sorting',
    'Searching',
    'Greedy',
    'Hashing',
    'Heap',
    'Trie',
    'Union Find',
    'Bit Manipulation',
    'Matrix',
    'Math',
];

const testimonials = [
    'Best platform for collaborative coding interviews.',
    'Perfect tool for team-based coding practice.',
    'The closest experience to real pair-programming interviews.',
];

const contestLeaderboardStorageKey = 'sync-code-contest-leaderboard';
const defaultContestLeaderboard = [
    { username: 'Anuj', solved: 5, penalty: 12, score: 488 },
    { username: 'Priya', solved: 4, penalty: 8, score: 432 },
    { username: 'Rahul', solved: 4, penalty: 17, score: 423 },
];

const homeFeatureHighlights = [
    {
        title: 'Real-Time Collaboration',
        points: ['Live cursors', 'Shared editing', 'Typing indicators', 'Selection presence'],
        accent: 'from-[#6366F1] to-[#8B5CF6]',
    },
    {
        title: 'Voice + Presence',
        points: ['Optional in-room voice', 'Online participant cards', 'Cursor line chips', 'Speaker activity states'],
        accent: 'from-[#0EA5E9] to-[#22D3EE]',
    },
    {
        title: 'Contest Mode',
        points: ['Timed multi-problem rounds', 'Penalty controls', 'Leaderboard snapshots', 'Quick launch to editor'],
        accent: 'from-[#10B981] to-[#22C55E]',
    },
    {
        title: 'Interview Toolkit',
        points: ['Custom test cases', 'Runtime trend charts', 'Whiteboard collaboration', 'Shareable read-only links'],
        accent: 'from-[#F59E0B] to-[#F97316]',
    },
];

const stylePresets = {
    A: {
        rootBg: 'bg-[radial-gradient(circle_at_15%_10%,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_85%_8%,rgba(139,92,246,0.2),transparent_30%),linear-gradient(180deg,#020617_0%,#0F172A_38%,#1E1B4B_100%)]',
        heroHeading: 'bg-[linear-gradient(120deg,#F8FAFC,#A78BFA,#22D3EE)] bg-clip-text text-transparent',
        primaryBtn: 'bg-[linear-gradient(135deg,#6366F1,#8B5CF6,#A855F7)] text-[#F8FAFC] shadow-[0_0_28px_rgba(139,92,246,0.35)] hover:shadow-[0_0_34px_rgba(167,139,250,0.55)]',
        secondaryBtn: 'border-[#22D3EE] bg-[#22D3EE]/5 text-[#22D3EE] hover:bg-[#22D3EE]/15 hover:shadow-[0_0_22px_rgba(34,211,238,0.28)]',
        cardBg: 'bg-[linear-gradient(160deg,#020617,#111827)]',
        cardHover: 'hover:border-[#8B5CF6] hover:shadow-[0_0_24px_rgba(139,92,246,0.3)]',
        ctaBtn: 'bg-[linear-gradient(135deg,#6366F1,#A78BFA,#22D3EE)] text-[#020617] shadow-[0_0_34px_rgba(139,92,246,0.45)] hover:shadow-[0_0_38px_rgba(167,139,250,0.62)]',
    },
    B: {
        rootBg: 'bg-[radial-gradient(circle_at_20%_0%,rgba(59,130,246,0.2),transparent_30%),radial-gradient(circle_at_80%_5%,rgba(6,182,212,0.18),transparent_30%),linear-gradient(180deg,#020617_0%,#0B1220_45%,#111827_100%)]',
        heroHeading: 'bg-[linear-gradient(120deg,#F8FAFC,#93C5FD,#22D3EE)] bg-clip-text text-transparent',
        primaryBtn: 'bg-[linear-gradient(135deg,#2563EB,#0EA5E9,#06B6D4)] text-[#F8FAFC] shadow-[0_0_28px_rgba(14,165,233,0.32)] hover:shadow-[0_0_34px_rgba(34,211,238,0.46)]',
        secondaryBtn: 'border-[#60A5FA] bg-[#60A5FA]/5 text-[#7DD3FC] hover:bg-[#60A5FA]/15 hover:shadow-[0_0_22px_rgba(96,165,250,0.25)]',
        cardBg: 'bg-[linear-gradient(160deg,#020617,#0B1220)]',
        cardHover: 'hover:border-[#38BDF8] hover:shadow-[0_0_24px_rgba(56,189,248,0.28)]',
        ctaBtn: 'bg-[linear-gradient(135deg,#2563EB,#0EA5E9,#22D3EE)] text-[#F8FAFC] shadow-[0_0_34px_rgba(14,165,233,0.4)] hover:shadow-[0_0_38px_rgba(34,211,238,0.55)]',
    },
    C: {
        rootBg: 'bg-[radial-gradient(circle_at_15%_10%,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_85%_8%,rgba(236,72,153,0.18),transparent_30%),linear-gradient(180deg,#020617_0%,#111827_42%,#312E81_100%)]',
        heroHeading: 'bg-[linear-gradient(120deg,#F8FAFC,#34D399,#F472B6)] bg-clip-text text-transparent',
        primaryBtn: 'bg-[linear-gradient(135deg,#10B981,#14B8A6,#22D3EE)] text-[#03211a] shadow-[0_0_28px_rgba(16,185,129,0.36)] hover:shadow-[0_0_34px_rgba(20,184,166,0.55)]',
        secondaryBtn: 'border-[#F472B6] bg-[#F472B6]/5 text-[#F9A8D4] hover:bg-[#F472B6]/15 hover:shadow-[0_0_22px_rgba(244,114,182,0.3)]',
        cardBg: 'bg-[linear-gradient(160deg,#020617,#1F2937)]',
        cardHover: 'hover:border-[#34D399] hover:shadow-[0_0_24px_rgba(52,211,153,0.3)]',
        ctaBtn: 'bg-[linear-gradient(135deg,#10B981,#A78BFA,#F472B6)] text-[#0b1320] shadow-[0_0_34px_rgba(52,211,153,0.36)] hover:shadow-[0_0_38px_rgba(244,114,182,0.45)]',
    },
};

const getDisplayName = (user) => {
    if (!user) return '';
    if (user.displayName) return user.displayName;
    if (user.email) return user.email.split('@')[0];
    if (user.phoneNumber) return user.phoneNumber;
    return 'Guest';
};

const demoCodeSnippet = `function solve(s) {
    const seen = new Set();
    let l = 0, ans = 0;
    for (let r = 0; r < s.length; r++) {
        while (seen.has(s[r])) seen.delete(s[l++]);
        seen.add(s[r]);
        ans = Math.max(ans, r - l + 1);
    }
    return ans;
}`;

const demoInputOptions = ['abcabcbb', 'bbbbb', 'pwwkew', 'dvdf'];

const runLongestSubstringDemo = (value = '') => {
    const seen = new Set();
    let left = 0;
    let answer = 0;

    for (let right = 0; right < value.length; right += 1) {
        while (seen.has(value[right])) {
            seen.delete(value[left]);
            left += 1;
        }
        seen.add(value[right]);
        answer = Math.max(answer, right - left + 1);
    }

    return answer;
};

const buildLongestSubstringFrames = (value = '') => {
    const normalizedInput = `${value || ''}`;
    const frames = [];
    const seen = new Set();
    let left = 0;
    let best = 0;

    if (!normalizedInput) {
        return [{
            step: 0,
            left: 0,
            right: -1,
            char: '',
            window: '',
            seen: [],
            best: 0,
            note: 'Empty input.',
        }];
    }

    for (let right = 0; right < normalizedInput.length; right += 1) {
        const nextChar = normalizedInput[right];
        while (seen.has(nextChar)) {
            seen.delete(normalizedInput[left]);
            left += 1;
        }

        seen.add(nextChar);
        best = Math.max(best, right - left + 1);

        frames.push({
            step: right + 1,
            left,
            right,
            char: nextChar,
            window: normalizedInput.slice(left, right + 1),
            seen: [...seen],
            best,
            note: `Processed '${nextChar}', window='${normalizedInput.slice(left, right + 1)}', best=${best}`,
        });
    }

    return frames;
};

const Home = () => {
    const navigate = useNavigate();

    const [roomId, setRoomId] = useState('');
    const [username, setUsername] = useState('');
    const [currentUser, setCurrentUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [otp, setOtp] = useState('');
    const [phoneConfirmation, setPhoneConfirmation] = useState(null);
    const [authMode, setAuthMode] = useState('signin');
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
    const [forgotPasswordOtp, setForgotPasswordOtp] = useState('');
    const [forgotPasswordNewPassword, setForgotPasswordNewPassword] = useState('');
    const [isForgotPasswordRequesting, setIsForgotPasswordRequesting] = useState(false);
    const [isForgotPasswordResetting, setIsForgotPasswordResetting] = useState(false);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [activeTrustedByIndex, setActiveTrustedByIndex] = useState(0);
    const [activeTestimonialIndex, setActiveTestimonialIndex] = useState(0);
    const [selectedProblemTopic, setSelectedProblemTopic] = useState('');
    const [topicProblems, setTopicProblems] = useState([]);
    const [isTopicProblemsLoading, setIsTopicProblemsLoading] = useState(false);
    const [totalQuestionCount, setTotalQuestionCount] = useState(1000);
    const [adaptiveRecommendations, setAdaptiveRecommendations] = useState([]);
    const [weakTopics, setWeakTopics] = useState([]);
    const [companyTracks, setCompanyTracks] = useState([]);
    const [selectedTrackId, setSelectedTrackId] = useState('');
    const [selectedTrackProblems, setSelectedTrackProblems] = useState([]);
    const [loadingTrackId, setLoadingTrackId] = useState('');
    const [sheetSummary, setSheetSummary] = useState({templates: [], reminders: []});
    const [isDashboardLoading, setIsDashboardLoading] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
    const [demoRunState, setDemoRunState] = useState('idle');
    const [demoLogs, setDemoLogs] = useState([]);
    const [demoResultText, setDemoResultText] = useState('Ready. Click Run to execute the sample code.');
    const [selectedDemoInput, setSelectedDemoInput] = useState(demoInputOptions[0]);
    const [demoFrames, setDemoFrames] = useState(() => buildLongestSubstringFrames(demoInputOptions[0]));
    const [demoFrameIndex, setDemoFrameIndex] = useState(0);
    const [demoProgress, setDemoProgress] = useState(0);
    const [isLaunchingQuestion, setIsLaunchingQuestion] = useState(false);
    const [contestRoundCount, setContestRoundCount] = useState(3);
    const [contestRoundMinutes, setContestRoundMinutes] = useState(18);
    const [contestPenaltyMinutes, setContestPenaltyMinutes] = useState(8);
    const [isLaunchingContest, setIsLaunchingContest] = useState(false);
    const [contestLeaderboard, setContestLeaderboard] = useState(() => {
        try {
            const persisted = JSON.parse(localStorage.getItem(contestLeaderboardStorageKey) || 'null');
            if (Array.isArray(persisted) && persisted.length > 0) {
                return persisted;
            }
        } catch (_error) {
        }
        return defaultContestLeaderboard;
    });
    const [activeFeatureHighlight, setActiveFeatureHighlight] = useState(0);
    const profileMenuRef = useRef(null);
    const demoTimerRef = useRef(null);
    const demoTypeTimerRef = useRef(null);
    const demoFrameTimerRef = useRef(null);

    const activeStyle = stylePresets.A;

    useEffect(() => {
        const savedUsername = `${localStorage.getItem(USERNAME_PREF_STORAGE_KEY) || ''}`.trim();

        if (!isFirebaseConfigured || !auth) {
            try {
                const persistedUser = JSON.parse(localStorage.getItem(LOCAL_AUTH_STORAGE_KEY) || 'null');
                if (persistedUser?.uid) {
                    setCurrentUser(persistedUser);
                    setUsername(savedUsername || getDisplayName(persistedUser));
                } else {
                    setUsername(savedUsername || 'Guest');
                }
            } catch (error) {
                setUsername(savedUsername || 'Guest');
            }
            setAuthLoading(false);
            return () => {};
        }

        const unsub = onAuthStateChanged(auth, (user) => {
            setCurrentUser(user);
            setUsername(savedUsername || getDisplayName(user));
            setAuthLoading(false);
        });

        return () => unsub();
    }, []);

    const handleSaveUsername = () => {
        const normalized = `${username || ''}`.trim();
        if (!normalized) {
            toast.error('Username cannot be empty.');
            return;
        }
        localStorage.setItem(USERNAME_PREF_STORAGE_KEY, normalized);

        if (!isFirebaseConfigured || !auth) {
            const persistedUser = JSON.parse(localStorage.getItem(LOCAL_AUTH_STORAGE_KEY) || 'null');
            if (persistedUser?.uid) {
                const nextUser = {...persistedUser, displayName: normalized};
                localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(nextUser));
                setCurrentUser(nextUser);
            }
        }

        toast.success('Username updated.');
    };

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setActiveTrustedByIndex((currentIndex) => (currentIndex + 1) % trustedBy.length);
        }, 1100);

        return () => window.clearInterval(intervalId);
    }, []);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setActiveTestimonialIndex((currentIndex) => (currentIndex + 1) % testimonials.length);
        }, 1300);

        return () => window.clearInterval(intervalId);
    }, []);

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setActiveFeatureHighlight((currentIndex) => (currentIndex + 1) % homeFeatureHighlights.length);
        }, 1800);

        return () => window.clearInterval(intervalId);
    }, []);

    useEffect(() => {
        localStorage.setItem(contestLeaderboardStorageKey, JSON.stringify(contestLeaderboard.slice(0, 10)));
    }, [contestLeaderboard]);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (!profileMenuRef.current) return;
            if (!profileMenuRef.current.contains(event.target)) {
                setIsProfileMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    useEffect(() => {
        return () => {
            if (demoTimerRef.current) {
                clearTimeout(demoTimerRef.current);
            }
            if (demoTypeTimerRef.current) {
                clearTimeout(demoTypeTimerRef.current);
            }
            if (demoFrameTimerRef.current) {
                clearTimeout(demoFrameTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const incomingEmail = params.get('email') || '';

        if (incomingEmail) {
            setShowForgotPassword(true);
            setAuthMode('signin');
            if (incomingEmail) {
                setForgotPasswordEmail(incomingEmail);
            }
            scrollToSection('cta');
        }
    }, []);

    useEffect(() => {
        const expected = runLongestSubstringDemo(selectedDemoInput);
        const nextFrames = buildLongestSubstringFrames(selectedDemoInput);

        if (demoTimerRef.current) {
            clearTimeout(demoTimerRef.current);
        }
        if (demoTypeTimerRef.current) {
            clearTimeout(demoTypeTimerRef.current);
        }
        if (demoFrameTimerRef.current) {
            clearTimeout(demoFrameTimerRef.current);
        }

        setDemoRunState('idle');
        setDemoFrames(nextFrames);
        setDemoFrameIndex(0);
        setDemoProgress(0);
        setDemoLogs([`Input switched to "${selectedDemoInput}"`, `Expected longest unique substring length = ${expected}`]);
        setDemoResultText(`Ready. Expected output for current input is ${expected}.`);
    }, [selectedDemoInput]);

    useEffect(() => {
        const loadProblemMeta = async () => {
            try {
                const response = await fetch(`${backendBaseUrl}/api/problems/meta`);
                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data?.error || 'Failed to load question metadata.');
                }

                const total = Number(data?.totalCount);
                if (Number.isFinite(total) && total > 0) {
                    setTotalQuestionCount(total);
                }
            } catch (_error) {
                setTotalQuestionCount(1000);
            }
        };

        loadProblemMeta();
    }, []);

    useEffect(() => {
        const usernameKey = username || getDisplayName(currentUser || {});
        if (!usernameKey) {
            return;
        }

        const loadAdaptiveModules = async () => {
            setIsDashboardLoading(true);
            try {
                const [recommendRes, tracksRes, sheetsRes] = await Promise.all([
                    fetch(`${backendBaseUrl}/api/recommendations?username=${encodeURIComponent(usernameKey)}`),
                    fetch(`${backendBaseUrl}/api/tracks`),
                    fetch(`${backendBaseUrl}/api/sheets?username=${encodeURIComponent(usernameKey)}`),
                ]);

                const recommendData = await recommendRes.json();
                const tracksData = await tracksRes.json();
                const sheetsData = await sheetsRes.json();

                if (recommendRes.ok) {
                    const nextRecommendations = Array.isArray(recommendData?.recommendations) ? recommendData.recommendations : [];
                    if (nextRecommendations.length > 0 && nextRecommendations.some((entry) => Array.isArray(entry?.problems) && entry.problems.length > 0)) {
                        setAdaptiveRecommendations(nextRecommendations);
                    } else {
                        const starterRes = await fetch(`${backendBaseUrl}/api/problems?page=1&limit=8`);
                        const starterData = await starterRes.json();
                        if (starterRes.ok) {
                            setAdaptiveRecommendations([
                                {
                                    topic: 'start-here',
                                    problems: Array.isArray(starterData?.problems) ? starterData.problems.slice(0, 6) : [],
                                },
                            ]);
                        } else {
                            setAdaptiveRecommendations([]);
                        }
                    }
                    setWeakTopics(Array.isArray(recommendData?.weakTopics) ? recommendData.weakTopics : []);
                }

                if (tracksRes.ok) {
                    setCompanyTracks(Array.isArray(tracksData?.tracks) ? tracksData.tracks : []);
                }

                if (sheetsRes.ok) {
                    setSheetSummary({
                        templates: Array.isArray(sheetsData?.templates) ? sheetsData.templates : [],
                        reminders: Array.isArray(sheetsData?.reminders) ? sheetsData.reminders : [],
                    });
                }
            } catch (_error) {
                setAdaptiveRecommendations([]);
                setCompanyTracks([]);
                setSheetSummary({templates: [], reminders: []});
            } finally {
                setIsDashboardLoading(false);
            }
        };

        loadAdaptiveModules();
    }, [currentUser, username]);

    const handleOpenTrack = async (trackId) => {
        if (!trackId) return;

        if (selectedTrackId === trackId) {
            setSelectedTrackId('');
            setSelectedTrackProblems([]);
            return;
        }

        setLoadingTrackId(trackId);
        setSelectedTrackId(trackId);
        try {
            const response = await fetch(`${backendBaseUrl}/api/tracks/${trackId}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || 'Failed to load track.');
            setSelectedTrackProblems(Array.isArray(data?.problems) ? data.problems : []);
            window.setTimeout(() => scrollToSection('company-track-preview'), 60);
        } catch (error) {
            setSelectedTrackId('');
            setSelectedTrackProblems([]);
            toast.error(error.message || 'Failed to load track.');
        } finally {
            setLoadingTrackId('');
        }
    };

    const handleQuickSheetCheckIn = async (sheetId) => {
        const usernameKey = username || getDisplayName(currentUser || {});
        if (!usernameKey) {
            toast.error('Sign in to check-in on sheets.');
            return;
        }

        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        try {
            const response = await fetch(`${backendBaseUrl}/api/sheets/checkin`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    username: usernameKey,
                    sheetId,
                    solvedCount: 1,
                    reminderAt: tomorrow,
                }),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || 'Check-in failed.');
            toast.success(`Check-in saved for ${sheetId}. Reminder set for tomorrow.`);
        } catch (error) {
            toast.error(error.message || 'Check-in failed.');
        }
    };

    const handleRunProductDemo = () => {
        if (demoRunState === 'running') {
            return;
        }

        if (demoTimerRef.current) {
            clearTimeout(demoTimerRef.current);
        }
        if (demoTypeTimerRef.current) {
            clearTimeout(demoTypeTimerRef.current);
        }
        if (demoFrameTimerRef.current) {
            clearTimeout(demoFrameTimerRef.current);
        }

        const sampleInput = selectedDemoInput;
        const frames = buildLongestSubstringFrames(sampleInput);
        const result = runLongestSubstringDemo(sampleInput);
        const scriptedLogs = [
            `Input received: "${sampleInput}"`,
            'Initialize window pointers and set',
            'Scan characters and shrink window on duplicates',
            'Track best window length during traversal',
            `Computed answer = ${result}`,
        ];

        setDemoRunState('running');
        setDemoLogs([scriptedLogs[0]]);
        setDemoResultText('Running...');
        setDemoFrames(frames);
        setDemoFrameIndex(0);
        setDemoProgress(0);

        let frameIndex = 0;
        const animateFrames = () => {
            if (frameIndex < frames.length) {
                const frame = frames[frameIndex];
                setDemoFrameIndex(frameIndex);
                setDemoProgress(Math.round(((frameIndex + 1) / Math.max(frames.length, 1)) * 100));
                setDemoLogs((prev) => {
                    const next = [...prev, frame.note];
                    return next.slice(-8);
                });
                frameIndex += 1;
                demoFrameTimerRef.current = setTimeout(animateFrames, 360);
                return;
            }

            let logIndex = 1;
            const pushSummaryLogs = () => {
                if (logIndex < scriptedLogs.length) {
                    setDemoLogs((prev) => {
                        const next = [...prev, scriptedLogs[logIndex]];
                        return next.slice(-10);
                    });
                    logIndex += 1;
                    demoTimerRef.current = setTimeout(pushSummaryLogs, 220);
                    return;
                }

                const finalText = `Output: ${result}`;
                let textIndex = 0;
                setDemoResultText('');

                const typeNextChar = () => {
                    if (textIndex < finalText.length) {
                        setDemoResultText((prev) => prev + finalText[textIndex]);
                        textIndex += 1;
                        demoTypeTimerRef.current = setTimeout(typeNextChar, 38);
                        return;
                    }

                    setDemoRunState('success');
                    setDemoProgress(100);
                };

                typeNextChar();
            };

            pushSummaryLogs();
        };

        animateFrames();
    };

    const ensureRecaptcha = () => {
        if (!auth) return null;
        if (!window.recaptchaVerifier) {
            window.recaptchaVerifier = new RecaptchaVerifier(auth, 'otp-recaptcha', {
                size: 'invisible',
            });
        }
        return window.recaptchaVerifier;
    };

    const scrollToSection = (sectionId) => {
        document.getElementById(sectionId)?.scrollIntoView({behavior: 'smooth', block: 'start'});
    };

    const toCategorySlug = (categoryLabel) => categoryLabel.toLowerCase().replace(/\s+/g, '-');

    const handleCategoryClick = async (categoryLabel) => {
        if (selectedProblemTopic === categoryLabel) {
            setSelectedProblemTopic('');
            setTopicProblems([]);
            return;
        }

        const categorySlug = toCategorySlug(categoryLabel);
        setSelectedProblemTopic(categoryLabel);
        setIsTopicProblemsLoading(true);

        try {
            const params = new URLSearchParams({
                category: categorySlug,
                page: '1',
                limit: '50',
            });
            const response = await fetch(`${backendBaseUrl}/api/problems?${params.toString()}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || 'Failed to load topic questions.');
            setTopicProblems(Array.isArray(data?.problems) ? data.problems : []);
            window.setTimeout(() => scrollToSection('topic-questions'), 80);
        } catch (error) {
            setTopicProblems([]);
            toast.error(error.message || 'Failed to load topic questions.');
        } finally {
            setIsTopicProblemsLoading(false);
        }
    };

    const createNewRoom = async () => {
        const id = uuidV4();
        try {
            const response = await fetch(`${backendBaseUrl}/api/rooms/create`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({roomId: id}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || 'Failed to create room.');
            setRoomId(id);
            toast.success('Created a new room');
            scrollToSection('cta');
        } catch (error) {
            toast.error(error.message || 'Failed to create room.');
        }
    };

    const buildLaunchProfile = (launchUsername) => {
        if (currentUser) {
            return {
                uid: currentUser.uid,
                displayName: getDisplayName(currentUser),
                email: currentUser.email || '',
                phoneNumber: currentUser.phoneNumber || '',
                photoURL: currentUser.photoURL || '',
            };
        }

        return {
            uid: `guest-${launchUsername.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'solo'}`,
            displayName: launchUsername,
            email: '',
            phoneNumber: '',
            photoURL: '',
        };
    };

    const handleLaunchQuestion = async (problemId, problemTitle = '') => {
        if (!problemId) {
            toast.error('Question is unavailable right now.');
            return;
        }

        const launchUsername = `${username || getDisplayName(currentUser) || 'Guest'}`.trim();
        if (!launchUsername) {
            toast.error('Please set a username first.');
            scrollToSection('cta');
            return;
        }

        setIsLaunchingQuestion(true);

        try {
            navigate('/editor', {
                state: {
                    username: launchUsername,
                    profile: buildLaunchProfile(launchUsername),
                    selectedProblemId: problemId,
                    selectedProblemTitle: problemTitle,
                    launchMode: 'solo-problem',
                },
            });
            toast.success(`Opened ${problemTitle || 'problem'} in solo editor.`);
        } catch (error) {
            toast.error(error.message || 'Failed to open selected question.');
        } finally {
            setIsLaunchingQuestion(false);
        }
    };

    const handleLaunchContestMode = async () => {
        const launchUsername = `${username || getDisplayName(currentUser) || 'Guest'}`.trim();
        if (!launchUsername) {
            toast.error('Please set a username first.');
            scrollToSection('cta');
            return;
        }

        const safeRoundCount = Math.min(Math.max(Number(contestRoundCount) || 3, 2), 8);
        const safeRoundMinutes = Math.min(Math.max(Number(contestRoundMinutes) || 18, 8), 60);
        const safePenalty = Math.min(Math.max(Number(contestPenaltyMinutes) || 8, 0), 30);

        setIsLaunchingContest(true);

        try {
            const response = await fetch(`${backendBaseUrl}/api/problems?page=1&limit=100`);
            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload?.error || 'Failed to load contest problems.');
            }

            const allProblems = Array.isArray(payload?.problems) ? payload.problems : [];
            if (allProblems.length < safeRoundCount) {
                throw new Error('Not enough problems available to build this contest.');
            }

            const randomized = [...allProblems].sort(() => Math.random() - 0.5).slice(0, safeRoundCount);
            const contestId = `contest-${Date.now()}`;
            const contestState = {
                enabled: true,
                contestId,
                createdAt: Date.now(),
                roundCount: safeRoundCount,
                roundMinutes: safeRoundMinutes,
                penaltyMinutes: safePenalty,
                problems: randomized.map((problem, index) => ({
                    id: problem.id,
                    title: problem.title,
                    difficulty: problem.difficulty || 'medium',
                    order: index + 1,
                })),
                leaderboard: contestLeaderboard.slice(0, 10),
            };

            setContestLeaderboard((prev) => {
                const penaltyScore = safePenalty * 4;
                const baseScore = Math.max(120, safeRoundCount * 120 - penaltyScore);
                const nextEntry = {
                    username: launchUsername,
                    solved: 0,
                    penalty: safePenalty,
                    score: baseScore,
                };

                const merged = [
                    ...prev.filter((entry) => entry.username !== launchUsername),
                    nextEntry,
                ].sort((left, right) => {
                    if (right.solved !== left.solved) return right.solved - left.solved;
                    if (left.penalty !== right.penalty) return left.penalty - right.penalty;
                    return right.score - left.score;
                });

                return merged.slice(0, 10);
            });

            navigate('/editor', {
                state: {
                    username: launchUsername,
                    profile: buildLaunchProfile(launchUsername),
                    selectedProblemId: randomized[0].id,
                    selectedProblemTitle: randomized[0].title,
                    launchMode: 'contest',
                    contestMode: contestState,
                },
            });

            toast.success(`Contest mode launched: ${safeRoundCount} rounds · ${safeRoundMinutes} min each.`);
        } catch (error) {
            toast.error(error.message || 'Failed to launch contest mode.');
        } finally {
            setIsLaunchingContest(false);
        }
    };

    const joinRoom = async () => {
        if (!currentUser) {
            toast.error('Please sign in first.');
            return;
        }
        if (!roomId || !username) {
            toast.error('Room ID and username are required.');
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/rooms/${roomId}/exists`);
            const data = await response.json();
            if (!response.ok) throw new Error(data?.error || 'Failed to validate room.');

            if (!data.exists) {
                toast.error('No room found with this ID. Create a new room or use a valid invite.');
                return;
            }

            navigate(`/editor/${roomId}`, {
                state: {
                    username,
                    profile: {
                        uid: currentUser.uid,
                        displayName: getDisplayName(currentUser),
                        email: currentUser.email || '',
                        phoneNumber: currentUser.phoneNumber || '',
                        photoURL: currentUser.photoURL || '',
                    },
                },
            });
        } catch (error) {
            toast.error(error.message || 'Failed to join room.');
        }
    };

    const solveSolo = () => {
        const launchUsername = `${username || getDisplayName(currentUser) || 'Solo User'}`.trim() || 'Solo User';
        navigate('/editor', {
            state: {
                username: launchUsername,
                profile: currentUser
                    ? {
                        uid: currentUser.uid,
                        displayName: getDisplayName(currentUser),
                        email: currentUser.email || '',
                        phoneNumber: currentUser.phoneNumber || '',
                        photoURL: currentUser.photoURL || '',
                    }
                    : {
                        uid: 'solo-guest',
                        displayName: launchUsername,
                        email: '',
                        phoneNumber: '',
                        photoURL: '',
                    },
            },
        });
    };

    const handleGoogleSignIn = async () => {
        if (!isFirebaseConfigured || !auth || !googleProvider) {
            toast.error('Google sign-in requires Firebase configuration.');
            return;
        }
        try {
            await signInWithPopup(auth, googleProvider);
            toast.success('Signed in with Google.');
        } catch (error) {
            toast.error(error.message || 'Google sign-in failed.');
        }
    };

    const handleEmailLogin = async () => {
        if (!email || !password) {
            toast.error('Email and password are required.');
            return;
        }

        if (!isFirebaseConfigured || !auth) {
            try {
                const response = await fetch(`${backendBaseUrl}/api/auth/login`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({email, password}),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error || 'Sign in failed.');

                setCurrentUser(payload.user);
                setUsername(getDisplayName(payload.user));
                localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(payload.user));
                toast.success('Signed in successfully.');
                return;
            } catch (error) {
                toast.error(error.message || 'Sign in failed.');
                return;
            }
        }

        try {
            await signInWithEmailAndPassword(auth, email, password);
            toast.success('Signed in successfully.');
        } catch (error) {
            toast.error(error.message || 'Email login failed.');
        }
    };

    const handleEmailSignup = async () => {
        if (!email || !password) {
            toast.error('Email and password are required.');
            return;
        }

        if (!isFirebaseConfigured || !auth) {
            try {
                const response = await fetch(`${backendBaseUrl}/api/auth/signup`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({email, password, displayName: email.split('@')[0]}),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error || 'Account creation failed.');

                setCurrentUser(payload.user);
                setUsername(getDisplayName(payload.user));
                localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(payload.user));
                toast.success('Account created. You are now signed in.');
                return;
            } catch (error) {
                toast.error(error.message || 'Account creation failed.');
                return;
            }
        }

        try {
            await createUserWithEmailAndPassword(auth, email, password);
            toast.success('Account created. You are now signed in.');
        } catch (error) {
            toast.error(error.message || 'Signup failed.');
        }
    };

    const handleForgotPasswordRequest = async () => {
        if (!forgotPasswordEmail.trim()) {
            toast.error('Enter your registered email first.');
            return;
        }

        setIsForgotPasswordRequesting(true);
        setForgotPasswordOtp('');
        try {
            if (isFirebaseConfigured && auth) {
                await sendPasswordResetEmail(auth, forgotPasswordEmail.trim());
                toast.success('Password reset link sent to your email.');
                return;
            }

            const response = await fetch(`${backendBaseUrl}/api/auth/forgot-password/request`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    email: forgotPasswordEmail.trim(),
                    method: 'otp',
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Failed to send recovery details.');

            if (payload?.delivery === 'console') {
                toast.error('Email service is not configured, so OTP/link was NOT sent to inbox. Configure SMTP in .env.');
                return;
            }
            toast.success(payload?.message || 'Recovery details sent to your email.');
        } catch (error) {
            toast.error(error.message || 'Failed to send recovery details.');
        } finally {
            setIsForgotPasswordRequesting(false);
        }
    };

    const handleForgotPasswordReset = async () => {
        if (!forgotPasswordEmail.trim()) {
            toast.error('Email is required.');
            return;
        }

        if (!forgotPasswordNewPassword.trim()) {
            toast.error('Enter a new password first.');
            return;
        }

        if (!forgotPasswordOtp.trim()) {
            toast.error('Provide OTP to continue.');
            return;
        }

        setIsForgotPasswordResetting(true);
        try {
            const response = await fetch(`${backendBaseUrl}/api/auth/forgot-password/reset`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    email: forgotPasswordEmail.trim(),
                    otp: forgotPasswordOtp.trim(),
                    newPassword: forgotPasswordNewPassword,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error || 'Failed to reset password.');

            toast.success(payload?.message || 'Password reset successful. Sign in with new password.');
            setShowForgotPassword(false);
            setForgotPasswordOtp('');
            setForgotPasswordNewPassword('');
        } catch (error) {
            toast.error(error.message || 'Failed to reset password.');
        } finally {
            setIsForgotPasswordResetting(false);
        }
    };

    const handleSendOtp = async () => {
        if (!isFirebaseConfigured || !auth) {
            toast.error('OTP requires Firebase configuration.');
            return;
        }
        if (!phoneNumber) {
            toast.error('Enter mobile number in +countrycode format.');
            return;
        }

        try {
            const verifier = ensureRecaptcha();
            const confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
            setPhoneConfirmation(confirmation);
            toast.success('OTP sent successfully.');
        } catch (error) {
            toast.error(error.message || 'Failed to send OTP.');
        }
    };

    const handleVerifyOtp = async () => {
        if (!phoneConfirmation || !otp) {
            toast.error('Enter OTP first.');
            return;
        }
        try {
            await phoneConfirmation.confirm(otp);
            setOtp('');
            setPhoneConfirmation(null);
            toast.success('Mobile OTP verified.');
        } catch (error) {
            toast.error(error.message || 'OTP verification failed.');
        }
    };

    const handleContinueAsGuest = () => {
        const guestUser = {
            uid: `guest-${Date.now()}`,
            displayName: username?.trim() || 'Guest',
            email: '',
            phoneNumber: '',
            photoURL: '',
        };
        setCurrentUser(guestUser);
        setUsername(getDisplayName(guestUser));
        localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(guestUser));
        toast.success('Continuing in guest mode.');
    };

    const handleLogout = async () => {
        if (!isFirebaseConfigured || !auth) {
            setCurrentUser(null);
            setUsername('');
            localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
            toast.success('Logged out.');
            return;
        }

        try {
            await signOut(auth);
            toast.success('Logged out successfully.');
        } catch (error) {
            toast.error(error.message || 'Failed to logout.');
        }
    };

    const handleChangePassword = async () => {
        if (!currentUser) {
            toast.error('Sign in first to change password.');
            return;
        }

        if (!oldPassword || !newPassword) {
            toast.error('Old and new password are required.');
            return;
        }

        if (newPassword.length < 6) {
            toast.error('New password must be at least 6 characters.');
            return;
        }

        if (oldPassword === newPassword) {
            toast.error('New password must be different from old password.');
            return;
        }

        if (!currentUser.email) {
            toast.error('Password change requires an email-based account.');
            return;
        }

        setIsChangingPassword(true);
        try {
            if (isFirebaseConfigured && auth?.currentUser) {
                const credential = EmailAuthProvider.credential(currentUser.email, oldPassword);
                await reauthenticateWithCredential(auth.currentUser, credential);
                await updatePassword(auth.currentUser, newPassword);
            } else {
                const response = await fetch(`${backendBaseUrl}/api/auth/change-password`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        email: currentUser.email,
                        oldPassword,
                        newPassword,
                    }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error || 'Failed to change password.');
            }

            setOldPassword('');
            setNewPassword('');
            setShowChangePassword(false);
            toast.success('Password changed successfully.');
        } catch (error) {
            toast.error(error.message || 'Failed to change password.');
        } finally {
            setIsChangingPassword(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#020617] text-[#F8FAFC]">

            <header className="sticky top-0 z-50 border-b border-[#1E293B] bg-[#020617]/95 backdrop-blur">
                <div className="mx-auto flex w-full items-center justify-between px-4 py-4">
                    <button type="button" onClick={() => scrollToSection('hero')} className="flex items-center gap-2 text-left">
                        <span className="text-2xl text-[#A78BFA]">⌘</span>
                        <span className="text-lg font-semibold tracking-wide">SYNC CODE</span>
                    </button>

                    <nav className="hidden items-center gap-7 text-sm text-[#94A3B8] md:flex">
                        <button type="button" onClick={() => scrollToSection('features')} className="transition hover:text-[#22D3EE]">Features</button>
                        <button type="button" onClick={() => scrollToSection('contest-mode')} className="transition hover:text-[#22D3EE]">Contest</button>
                        <button type="button" onClick={() => scrollToSection('collaborate')} className="transition hover:text-[#22D3EE]">Collaborate</button>
                        <button type="button" onClick={() => scrollToSection('problems')} className="transition hover:text-[#22D3EE]">Problems</button>
                        <button type="button" onClick={() => scrollToSection('docs')} className="transition hover:text-[#22D3EE]">Docs</button>
                        <button type="button" onClick={() => scrollToSection('about')} className="transition hover:text-[#22D3EE]">About</button>
                    </nav>

                    <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label="Toggle menu"
                        onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                        className="flex flex-col gap-1.5 p-2 md:hidden"
                    >
                        <span className={`block h-0.5 w-5 bg-[#94A3B8] transition-all duration-300 ${isMobileMenuOpen ? 'translate-y-2 rotate-45' : ''}`} />
                        <span className={`block h-0.5 w-5 bg-[#94A3B8] transition-all duration-300 ${isMobileMenuOpen ? 'opacity-0' : ''}`} />
                        <span className={`block h-0.5 w-5 bg-[#94A3B8] transition-all duration-300 ${isMobileMenuOpen ? '-translate-y-2 -rotate-45' : ''}`} />
                    </button>

                    <div ref={profileMenuRef} className="relative flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                            className="flex items-center gap-2 rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-sm font-semibold text-[#F8FAFC] transition hover:border-[#22D3EE]"
                        >
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#1E293B] text-xs font-bold text-[#22D3EE]">
                                {(username || getDisplayName(currentUser || {displayName: 'G'})).charAt(0).toUpperCase()}
                            </span>
                            <span className="max-w-[140px] truncate">{username || (currentUser ? getDisplayName(currentUser) : 'Profile')}</span>
                            <span className="text-xs text-[#94A3B8]">▾</span>
                        </button>

                        {isProfileMenuOpen ? (
                            <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-[#334155] bg-[#020617] p-3 shadow-[0_20px_55px_rgba(2,6,23,0.65)]">
                                {authLoading ? (
                                    <p className="px-2 py-3 text-sm text-[#94A3B8]">Loading profile...</p>
                                ) : !currentUser ? (
                                    <div className="space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAuthMode('signin');
                                                setIsProfileMenuOpen(false);
                                                setShowAuthModal(true);
                                            }}
                                            className="w-full rounded-lg border border-[#334155] px-3 py-2 text-left text-sm font-semibold transition hover:bg-[#111827]"
                                        >
                                            Sign In
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setAuthMode('signup');
                                                setIsProfileMenuOpen(false);
                                                setShowAuthModal(true);
                                            }}
                                            className="w-full rounded-lg border border-[#334155] px-3 py-2 text-left text-sm font-semibold transition hover:bg-[#111827]"
                                        >
                                            Create Account
                                        </button>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-2">
                                            <p className="text-sm font-semibold text-[#F8FAFC]">{username || getDisplayName(currentUser)}</p>
                                            <p className="mt-1 truncate text-xs text-[#94A3B8]">{currentUser.email || 'Signed in user'}</p>
                                        </div>
                                        <div className="space-y-2 rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-3">
                                            <input
                                                type="text"
                                                className="w-full rounded-lg border border-[#334155] bg-[#020617] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]"
                                                placeholder="Set username"
                                                value={username}
                                                onChange={(event) => setUsername(event.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={handleSaveUsername}
                                                className="w-full rounded-lg bg-[#1E293B] px-3 py-2 text-sm font-semibold transition hover:bg-[#334155]"
                                            >
                                                Save Username
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsProfileMenuOpen(false);
                                                scrollToSection('cta');
                                            }}
                                            className="w-full rounded-lg border border-[#334155] px-3 py-2 text-left text-sm font-semibold transition hover:bg-[#111827]"
                                        >
                                            Open Room Panel
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowChangePassword((prev) => !prev)}
                                            className="w-full rounded-lg border border-[#334155] px-3 py-2 text-left text-sm font-semibold transition hover:bg-[#111827]"
                                        >
                                            {showChangePassword ? 'Hide Change Password' : 'Change Password'}
                                        </button>
                                        {showChangePassword ? (
                                            <div className="space-y-2 rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-3">
                                                <input
                                                    type="password"
                                                    className="w-full rounded-lg border border-[#334155] bg-[#020617] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]"
                                                    placeholder="Old password"
                                                    value={oldPassword}
                                                    onChange={(event) => setOldPassword(event.target.value)}
                                                />
                                                <input
                                                    type="password"
                                                    className="w-full rounded-lg border border-[#334155] bg-[#020617] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]"
                                                    placeholder="New password"
                                                    value={newPassword}
                                                    onChange={(event) => setNewPassword(event.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleChangePassword}
                                                    disabled={isChangingPassword}
                                                    className="w-full rounded-lg bg-[#1E293B] px-3 py-2 text-sm font-semibold transition hover:bg-[#334155] disabled:opacity-50"
                                                >
                                                    {isChangingPassword ? 'Updating...' : 'Update Password'}
                                                </button>
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                setIsProfileMenuOpen(false);
                                                await handleLogout();
                                            }}
                                            className="w-full rounded-lg border border-[#334155] px-3 py-2 text-left text-sm font-semibold text-[#FCA5A5] transition hover:bg-[#111827]"
                                        >
                                            Logout
                                        </button>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>
                    </div>
                </div>
            </header>

            {isMobileMenuOpen ? (
                <div className="border-b border-[#1E293B] bg-[#020617]/98 md:hidden">
                    <nav className="flex flex-col px-4 py-3 text-sm text-[#94A3B8]">
                        {[['features','Features'],['contest-mode','Contest'],['collaborate','Collaborate'],['problems','Problems'],['docs','Docs'],['about','About']].map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                onClick={() => { scrollToSection(id); setIsMobileMenuOpen(false); }}
                                className="border-b border-[#1E293B] py-3 text-left transition hover:text-[#22D3EE]"
                            >
                                {label}
                            </button>
                        ))}
                        {!currentUser ? (
                            <button
                                type="button"
                                onClick={() => { setShowAuthModal(true); setIsMobileMenuOpen(false); }}
                                className="mt-2 rounded-lg border border-[#8B5CF6] px-4 py-2 text-center font-semibold text-[#A78BFA] transition hover:bg-[#8B5CF6]/10"
                            >
                                Sign In / Create Account
                            </button>
                        ) : null}
                    </nav>
                </div>
            ) : null}

            <main className="relative z-10">
                <section id="hero" className="mx-auto w-full px-4 pb-10 pt-16">
                    <div className={`grid gap-10 overflow-hidden rounded-[36px] border border-[#312E81] px-6 py-12 section-fade md:grid-cols-2 md:px-10 md:py-16 ${activeStyle.rootBg}`}>
                        <div className="section-fade">
                            <h1 className={`bg-clip-text text-4xl font-bold leading-tight text-transparent md:text-6xl ${activeStyle.heroHeading}`}>Collaborative Coding Made Powerful</h1>
                            <p className="mt-5 max-w-xl text-lg text-[#94A3B8]">
                                Write, run, and solve coding problems together in real time.
                            </p>
                            <div className="mt-8 flex flex-wrap gap-4">
                                <button
                                    type="button"
                                    onClick={createNewRoom}
                                    className={`rounded-xl px-6 py-3 font-semibold transition duration-200 ${activeStyle.primaryBtn}`}
                                >
                                    Create Room
                                </button>
                                <button
                                    type="button"
                                    onClick={() => scrollToSection('problems')}
                                    className={`rounded-xl border px-6 py-3 font-semibold transition ${activeStyle.secondaryBtn}`}
                                >
                                    Explore Problems
                                </button>
                            </div>
                        </div>

                        <div className="relative min-h-[360px] section-fade">
                            <div className="absolute inset-0 rounded-3xl bg-[radial-gradient(circle,#8B5CF633,transparent)]" />
                            <div className="absolute left-2 top-8 w-64 rounded-2xl border border-[#334155] bg-[#020617]/90 p-4 shadow-glow animate-float">
                                <p className="text-xs text-[#94A3B8]">Collaborative editor</p>
                                <p className="mt-2 font-mono text-sm text-[#22D3EE]">const team = ['Alice','Bob'];</p>
                            </div>
                            <div className="absolute right-3 top-20 w-60 rotate-2 rounded-2xl border border-[#334155] bg-[#020617]/90 p-4 shadow-cyan animate-float [animation-delay:0.8s]">
                                <p className="text-xs text-[#94A3B8]">User cursors</p>
                                <div className="mt-3 space-y-2 text-sm">
                                    <p className="text-[#A78BFA]">● Alice typing...</p>
                                    <p className="text-[#22D3EE]">● Bob at line 14</p>
                                </div>
                            </div>
                            <div className="absolute bottom-24 left-8 w-64 -rotate-2 rounded-2xl border border-[#334155] bg-[#020617]/90 p-4 shadow-glow animate-float [animation-delay:1.5s]">
                                <p className="text-xs text-[#94A3B8]">Problem panel</p>
                                <p className="mt-2 text-sm text-[#F8FAFC]">Two Sum • Medium • Test cases ready</p>
                            </div>
                            <div className="absolute bottom-6 right-8 rounded-xl border border-[#334155] bg-[#020617]/95 px-5 py-3 shadow-glow animate-pulseSoft">
                                <span className="text-sm font-semibold text-[#22C55E]">▶ Run Code</span>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mx-auto w-full px-4 py-10 section-fade">
                    <p className="text-center text-sm text-[#94A3B8]">
                        Developers preparing for interviews at top companies use Sync Code
                    </p>
                    <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
                        {trustedBy.map((company, index) => (
                            <button
                                key={company}
                                type="button"
                                onClick={() => window.open(trustedByLinks[company] || 'https://www.google.com', '_blank', 'noopener,noreferrer')}
                                className={`relative overflow-hidden rounded-xl border py-3 text-center text-sm font-semibold text-[#F8FAFC] transition duration-500 ${activeStyle.cardBg} ${activeStyle.cardHover} ${
                                    activeTrustedByIndex === index
                                        ? 'border-[#22D3EE] shadow-[0_0_26px_rgba(34,211,238,0.4)]'
                                        : 'border-[#334155]'
                                }`}
                            >
                                <span
                                    className={`pointer-events-none absolute inset-y-0 left-[-30%] w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.32),transparent)] transition-transform duration-700 ${
                                        activeTrustedByIndex === index ? 'translate-x-[260%]' : 'translate-x-0 opacity-0'
                                    }`}
                                />
                                {company}
                            </button>
                        ))}
                    </div>
                </section>

                <section id="features" className="mx-auto w-full px-4 py-14 section-fade">
                    <h2 className="text-center text-3xl font-bold">Powerful Features for Collaborative Coding</h2>
                    <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
                        {homeFeatureHighlights.map((feature, index) => (
                            <div
                                key={feature.title}
                                className={`relative overflow-hidden rounded-2xl border border-[#334155] p-6 transition duration-300 hover:-translate-y-1 ${activeStyle.cardBg} ${activeStyle.cardHover} ${
                                    activeFeatureHighlight === index
                                        ? 'border-[#22D3EE] shadow-[0_0_24px_rgba(34,211,238,0.3)]'
                                        : ''
                                }`}
                            >
                                <span
                                    className={`pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r ${feature.accent} ${
                                        activeFeatureHighlight === index ? 'opacity-100' : 'opacity-45'
                                    }`}
                                />
                                <h3 className="text-lg font-semibold">{feature.title}</h3>
                                <ul className="mt-4 space-y-2 text-sm text-[#94A3B8]">
                                    {feature.points.map((point) => (
                                        <li key={point}>• {point}</li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </section>

                <section id="docs" className="mx-auto w-full px-4 py-14 section-fade">
                    <div className={`rounded-3xl border border-[#334155] p-6 md:p-8 ${activeStyle.cardBg}`}>
                        <h2 className="text-center text-3xl font-bold">Product Demo</h2>
                        <div className="mt-8 grid gap-5 md:grid-cols-12">
                            <aside className="rounded-2xl border border-[#334155] bg-[#020617] p-4 md:col-span-4">
                                <p className="text-xs uppercase tracking-wide text-[#94A3B8]">Problem</p>
                                <h4 className="mt-2 font-semibold">Longest Substring Without Repeating Characters</h4>
                                <p className="mt-3 text-sm text-[#94A3B8]">Given a string, find the length of the longest substring without repeating characters.</p>
                            </aside>

                            <div className="rounded-2xl border border-[#334155] bg-[#020617] p-4 md:col-span-8">
                                <div className="mb-3 flex items-center justify-between">
                                    <div className="flex -space-x-2">
                                        {['A', 'B', 'C'].map((avatar) => (
                                            <span key={avatar} className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#1E293B] bg-[#1E1B4B] text-xs">
                                                {avatar}
                                            </span>
                                        ))}
                                    </div>
                                    <div className="mr-2 flex items-center gap-2">
                                        <span className="text-[11px] text-[#94A3B8]">Input</span>
                                        <select
                                            value={selectedDemoInput}
                                            onChange={(event) => setSelectedDemoInput(event.target.value)}
                                            className="rounded border border-[#334155] bg-[#0B1120] px-2 py-1 text-[11px] text-[#F8FAFC]"
                                        >
                                            {demoInputOptions.map((inputValue) => (
                                                <option key={inputValue} value={inputValue}>{inputValue}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleRunProductDemo}
                                        className="rounded-lg bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-2 text-xs font-semibold"
                                    >
                                        {demoRunState === 'running' ? 'Running...' : 'Run'}
                                    </button>
                                </div>
                                <pre className="overflow-x-auto rounded-xl bg-[#0B1120] p-4 text-sm text-[#A78BFA]">
{demoCodeSnippet}
                                </pre>
                                <div className="mt-3 rounded-xl border border-[#334155] bg-[#0B1120] p-3">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold text-[#22D3EE]">Execution Console</p>
                                        <span className={`text-[10px] font-semibold ${demoRunState === 'running' ? 'text-[#FBBF24] animate-pulse' : demoRunState === 'success' ? 'text-[#22C55E]' : 'text-[#60A5FA]'}`}>
                                            {demoRunState === 'running' ? 'RUNNING' : demoRunState === 'success' ? 'SUCCESS' : 'READY'}
                                        </span>
                                    </div>
                                    <div className="mt-2 h-2 w-full overflow-hidden rounded bg-[#1E293B]">
                                        <div
                                            className="h-2 rounded bg-[linear-gradient(90deg,#22D3EE,#8B5CF6)] transition-all duration-300"
                                            style={{ width: `${demoProgress}%` }}
                                        />
                                    </div>
                                    <div className="mt-2 rounded-lg border border-[#1E293B] bg-[#020617] p-2 text-[11px] text-[#A7F3D0]">
                                        <p>Current input: "{selectedDemoInput}"</p>
                                        <p>Window frame: {demoFrames[demoFrameIndex]?.window || '-'}</p>
                                        <p>Best length so far: {demoFrames[demoFrameIndex]?.best ?? runLongestSubstringDemo(selectedDemoInput)}</p>
                                    </div>
                                    <div className="mt-2 max-h-24 overflow-y-auto rounded-lg border border-[#1E293B] bg-[#020617] p-2 text-xs text-[#94A3B8]">
                                        {demoLogs.length === 0 ? (
                                            <p>No execution logs yet.</p>
                                        ) : (
                                            demoLogs.map((line) => <p key={line}>• {line}</p>)
                                        )}
                                    </div>
                                    <p className="mt-2 rounded-md bg-[#111827] px-2 py-1 text-sm font-semibold text-[#F8FAFC]">
                                        {demoResultText}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="collaborate" className="mx-auto w-full px-4 py-14 section-fade">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <h2 className="text-3xl font-bold">Collaboration Features</h2>
                            <ul className="mt-6 space-y-3 text-[#94A3B8]">
                                <li>• Live cursors</li>
                                <li>• Typing indicators</li>
                                <li>• Shared problem solving</li>
                            </ul>
                        </div>
                        <div className="relative rounded-2xl border border-[#334155] bg-[#020617] p-5">
                            <pre className="rounded-xl bg-[#0B1120] p-4 text-sm text-[#F8FAFC]">
{`// team-session.js
socket.on('cursor-move', updateCursor)
socket.on('typing-start', setTyping)
renderSharedEditor(roomId)`}
                            </pre>
                            <span className="absolute left-10 top-12 animate-float text-[#22D3EE]">⌖</span>
                            <span className="absolute right-12 top-20 animate-float [animation-delay:0.9s] text-[#A78BFA]">⌖</span>
                            <span className="absolute bottom-10 left-1/2 animate-float [animation-delay:1.4s] text-[#22C55E]">⌖</span>
                        </div>
                    </div>
                </section>

                <section id="contest-mode" className="mx-auto w-full px-4 py-12 section-fade">
                    <div className="rounded-3xl border border-[#334155] bg-[linear-gradient(145deg,rgba(2,6,23,0.95),rgba(17,24,39,0.94))] p-6 md:p-8">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#22D3EE]">Contest mode</p>
                                <h3 className="mt-2 text-2xl font-bold md:text-3xl">Timed multi-problem rounds with leaderboard + penalties</h3>
                            </div>
                            <span className="rounded-full border border-[#334155] bg-[#0B1120] px-3 py-1 text-xs font-semibold text-[#A78BFA]">
                                Competitive Practice
                            </span>
                        </div>

                        <div className="mt-7 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-5">
                                <p className="text-sm font-semibold text-[#F8FAFC]">Round planner</p>
                                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                                    <label className="rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-xs text-[#94A3B8]">
                                        Rounds
                                        <input
                                            type="number"
                                            min={2}
                                            max={8}
                                            value={contestRoundCount}
                                            onChange={(event) => setContestRoundCount(Number(event.target.value) || 3)}
                                            className="mt-2 w-full rounded-lg border border-[#334155] bg-[#020617] px-2 py-2 text-sm text-[#F8FAFC] outline-none focus:border-[#8B5CF6]"
                                        />
                                    </label>
                                    <label className="rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-xs text-[#94A3B8]">
                                        Minutes / round
                                        <input
                                            type="number"
                                            min={8}
                                            max={60}
                                            value={contestRoundMinutes}
                                            onChange={(event) => setContestRoundMinutes(Number(event.target.value) || 18)}
                                            className="mt-2 w-full rounded-lg border border-[#334155] bg-[#020617] px-2 py-2 text-sm text-[#F8FAFC] outline-none focus:border-[#8B5CF6]"
                                        />
                                    </label>
                                    <label className="rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-xs text-[#94A3B8]">
                                        Penalty (minutes)
                                        <input
                                            type="number"
                                            min={0}
                                            max={30}
                                            value={contestPenaltyMinutes}
                                            onChange={(event) => setContestPenaltyMinutes(Number(event.target.value) || 8)}
                                            className="mt-2 w-full rounded-lg border border-[#334155] bg-[#020617] px-2 py-2 text-sm text-[#F8FAFC] outline-none focus:border-[#8B5CF6]"
                                        />
                                    </label>
                                </div>

                                <div className="mt-4 rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 text-sm text-[#94A3B8]">
                                    <p>Contest summary: <span className="text-[#F8FAFC] font-semibold">{contestRoundCount} rounds · {contestRoundMinutes} min each · {contestPenaltyMinutes} min wrong-attempt penalty</span></p>
                                    <p className="mt-1 text-xs">Launch opens the editor with the first contest problem and a prepared contest packet.</p>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleLaunchContestMode}
                                    disabled={isLaunchingContest}
                                    className="mt-4 rounded-xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6,#22D3EE)] px-5 py-3 text-sm font-semibold text-[#F8FAFC] shadow-[0_0_22px_rgba(99,102,241,0.35)] transition hover:opacity-90 disabled:opacity-60"
                                >
                                    {isLaunchingContest ? 'Preparing Contest...' : '🚀 Launch Contest Mode'}
                                </button>
                            </div>

                            <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-5">
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-sm font-semibold text-[#F8FAFC]">Leaderboard (preview)</p>
                                    <span className="text-xs text-[#94A3B8]">Sorted by solved → penalty → score</span>
                                </div>
                                <div className="mt-4 space-y-2">
                                    {contestLeaderboard.slice(0, 6).map((entry, index) => (
                                        <div key={`${entry.username}-${index}`} className="grid grid-cols-[26px_1fr_auto_auto_auto] items-center gap-2 rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-2 text-xs">
                                            <span className="text-[#22D3EE]">#{index + 1}</span>
                                            <span className="truncate text-[#F8FAFC]">{entry.username}</span>
                                            <span className="text-[#A7F3D0]">{entry.solved} solved</span>
                                            <span className="text-[#FCD34D]">{entry.penalty}m pen</span>
                                            <span className="text-[#C4B5FD]">{entry.score}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="mx-auto w-full px-4 py-6 section-fade">
                    <div className="relative overflow-hidden rounded-[28px] border border-[#334155] bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,27,75,0.82))] px-6 py-8 md:px-8">
                        <div className="absolute left-10 top-1/2 h-36 w-36 -translate-y-1/2 rounded-full bg-[#22D3EE]/15 blur-3xl" />
                        <div className="absolute right-12 top-8 h-32 w-32 rounded-full bg-[#8B5CF6]/20 blur-3xl" />
                        <div className="relative grid gap-6 md:grid-cols-[1.1fr_0.9fr] md:items-center">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#22D3EE]">Shared workflow</p>
                                <h3 className="mt-3 text-2xl font-bold md:text-3xl">Move from live collaboration straight into curated interview problems.</h3>
                                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#94A3B8] md:text-base">
                                    Pair-program on one side, then hand the room a focused challenge with tests, difficulty tags, and ready-to-run examples without breaking session flow.
                                </p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl border border-[#334155] bg-[#020617]/80 p-4">
                                    <p className="text-xs uppercase tracking-wide text-[#94A3B8]">Live room</p>
                                    <p className="mt-2 text-sm font-semibold text-[#F8FAFC]">Multiple Collaborators Active</p>
                                    <p className="mt-1 text-sm text-[#22D3EE]">Cursor sync and typing indicators online</p>
                                </div>
                                <div className="rounded-2xl border border-[#334155] bg-[#020617]/80 p-4">
                                    <p className="text-xs uppercase tracking-wide text-[#94A3B8]">Next challenge</p>
                                    <p className="mt-2 text-sm font-semibold text-[#F8FAFC]">Graph traversal set queued</p>
                                    <p className="mt-1 text-sm text-[#A78BFA]">Multiple problems are ready to be assigned</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="problems" className="mx-auto w-full px-4 py-14 section-fade">
                    <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-3xl font-bold">Problem Library Preview</h2>
                        <span className="rounded-full border border-[#334155] bg-[#0B1120] px-3 py-1 text-xs font-semibold text-[#22D3EE]">
                            Total Questions: {totalQuestionCount}
                        </span>
                    </div>
                    <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                        {problemCategories.map((category) => (
                            <div
                                key={category}
                                className={`rounded-2xl border p-5 text-center transition duration-200 hover:-translate-y-1 ${activeStyle.cardBg} ${activeStyle.cardHover} ${selectedProblemTopic === category ? 'border-[#22D3EE] shadow-[0_0_22px_rgba(34,211,238,0.35)]' : 'border-[#334155]'}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => handleCategoryClick(category)}
                                    className="w-full text-center"
                                >
                                    <p className="font-medium">{category}</p>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleCategoryClick(category)}
                                    className="mt-3 rounded-lg border border-[#334155] px-3 py-1 text-xs font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10"
                                >
                                    {selectedProblemTopic === category ? 'Unload Questions' : 'Load Questions'}
                                </button>
                            </div>
                        ))}
                    </div>
                </section>

                {selectedProblemTopic ? (
                    <section id="topic-questions" className="mx-auto w-full px-4 pb-8 section-fade">
                        <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-6">
                            <h3 className="text-2xl font-bold">{selectedProblemTopic} Questions</h3>
                            {isTopicProblemsLoading ? (
                                <p className="mt-4 text-sm text-[#94A3B8]">Loading questions...</p>
                            ) : topicProblems.length === 0 ? (
                                <p className="mt-4 text-sm text-[#94A3B8]">No questions found for this topic right now.</p>
                            ) : (
                                <div className="mt-5 grid gap-3 md:grid-cols-2">
                                    {topicProblems.map((problem) => (
                                        <div key={problem.id} className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                            <p className="font-semibold text-[#F8FAFC]">{problem.title}</p>
                                            <p className="mt-2 text-sm text-[#94A3B8]">{(problem.statement || '').slice(0, 120)}{(problem.statement || '').length > 120 ? '...' : ''}</p>
                                            <div className="mt-3 flex items-center justify-between text-xs text-[#94A3B8]">
                                                <span>{(problem.difficulty || 'medium').toUpperCase()}</span>
                                                <span>{(problem.targetTimeComplexity || '').trim() || 'Complexity N/A'}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => handleLaunchQuestion(problem.id, problem.title)}
                                                disabled={isLaunchingQuestion}
                                                className="mt-3 rounded-lg border border-[#334155] px-3 py-1 text-xs font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10 disabled:opacity-50"
                                            >
                                                {isLaunchingQuestion ? 'Opening...' : 'Open in Editor'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                ) : null}

                <section id="adaptive-feed" className="mx-auto w-full px-4 py-10 section-fade">
                    <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-6">
                        <h3 className="text-2xl font-bold">Adaptive Practice Feed</h3>
                        <p className="mt-2 text-sm text-[#94A3B8]">Weak topics: {weakTopics.length > 0 ? weakTopics.join(', ') : 'No weakness data yet (run problems to unlock).'}</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            {isDashboardLoading ? (
                                [1,2,3,4].map((n) => (
                                    <div key={n} className="rounded-xl border border-[#1E293B] bg-[#0B1120] p-4">
                                        <div className="h-4 w-2/3 animate-pulse rounded bg-[#1E293B]" />
                                        <div className="mt-3 space-y-2">
                                            <div className="h-3 animate-pulse rounded bg-[#1E293B]" />
                                            <div className="h-3 w-4/5 animate-pulse rounded bg-[#1E293B]" />
                                            <div className="h-3 w-3/5 animate-pulse rounded bg-[#1E293B]" />
                                        </div>
                                    </div>
                                ))
                            ) : adaptiveRecommendations.length === 0 ? (
                                <p className="text-sm text-[#94A3B8]">No recommendations yet.</p>
                            ) : (
                                adaptiveRecommendations.map((entry) => (
                                    <div key={entry.topic} className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                        <p className="font-semibold capitalize text-[#22D3EE]">{entry.topic.replace(/-/g, ' ')}</p>
                                        <ul className="mt-2 space-y-1 text-sm text-[#94A3B8]">
                                            {(entry.problems || []).slice(0, 4).map((problem) => (
                                                <li key={problem.id} className="flex items-center justify-between gap-2">
                                                        <span>• {problem.title}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleLaunchQuestion(problem.id, problem.title)}
                                                        disabled={isLaunchingQuestion}
                                                        className="rounded border border-[#334155] px-2 py-1 text-[10px] font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10 disabled:opacity-50"
                                                    >
                                                        Open
                                                    </button>
                                                </li>
                                            ))}
                                            {(entry.problems || []).length === 0 ? <li>• No personalized matches yet.</li> : null}
                                        </ul>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </section>

                <section id="company-tracks" className="mx-auto w-full px-4 py-10 section-fade">
                    <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-6">
                        <h3 className="text-2xl font-bold">Company Prep Tracks</h3>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            {isDashboardLoading ? (
                                [1,2,3,4,5].map((n) => (
                                    <div key={n} className="rounded-xl border border-[#1E293B] bg-[#0B1120] p-3">
                                        <div className="h-4 w-3/4 animate-pulse rounded bg-[#1E293B]" />
                                        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[#1E293B]" />
                                        <div className="mt-3 h-7 animate-pulse rounded-lg bg-[#1E293B]" />
                                    </div>
                                ))
                            ) : companyTracks.length === 0 ? <p className="text-sm text-[#94A3B8]">No company tracks available right now.</p> : companyTracks.map((track) => (
                                <div
                                    key={track.id}
                                    className={`rounded-xl border p-3 text-left transition ${selectedTrackId === track.id ? 'border-[#22D3EE] bg-[#22D3EE]/10' : 'border-[#334155] bg-[#0B1120]'}`}
                                >
                                    <p className="font-semibold">{track.company}</p>
                                    <p className="mt-1 text-xs text-[#94A3B8]">{track.totalProblems} problems</p>
                                    <button
                                        type="button"
                                        onClick={() => handleOpenTrack(track.id)}
                                        className="mt-3 rounded-lg border border-[#334155] px-3 py-1 text-xs font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10"
                                    >
                                        {selectedTrackId === track.id
                                            ? 'Unload Questions'
                                            : loadingTrackId === track.id
                                            ? 'Loading...'
                                            : 'Load Questions'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {selectedTrackId ? (
                    <section id="company-track-preview" className="mx-auto w-full px-4 pb-8 section-fade">
                        <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-6">
                            <h3 className="text-2xl font-bold">Track Questions</h3>
                            <div className="mt-5 grid gap-3 md:grid-cols-2">
                                {selectedTrackProblems.slice(0, 12).map((problem) => (
                                    <div key={problem.id} className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                        <p className="font-semibold text-[#F8FAFC]">{problem.title}</p>
                                        <div className="mt-2 flex items-center justify-between text-xs text-[#94A3B8]">
                                            <span>{(problem.category || '').replace(/-/g, ' ')}</span>
                                            <span>{(problem.difficulty || 'medium').toUpperCase()}</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleLaunchQuestion(problem.id, problem.title)}
                                            disabled={isLaunchingQuestion}
                                            className="mt-3 rounded-lg border border-[#334155] px-3 py-1 text-xs font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10 disabled:opacity-50"
                                        >
                                            {isLaunchingQuestion ? 'Opening...' : 'Open in Editor'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </section>
                ) : null}

                <section id="sheet-reminders" className="mx-auto w-full px-4 py-10 section-fade">
                    <div className="rounded-2xl border border-[#334155] bg-[#020617]/90 p-6">
                        <h3 className="text-2xl font-bold">Sheets & Reminders</h3>
                        <p className="mt-2 text-sm text-[#94A3B8]">Blind 75 / NeetCode / custom sheets with collaborative check-ins.</p>
                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                            {isDashboardLoading ? (
                                [1,2].map((n) => (
                                    <div key={n} className="rounded-xl border border-[#1E293B] bg-[#0B1120] p-4">
                                        <div className="h-4 w-1/2 animate-pulse rounded bg-[#1E293B]" />
                                        <div className="mt-3 space-y-2">
                                            <div className="h-3 animate-pulse rounded bg-[#1E293B]" />
                                            <div className="h-3 w-4/5 animate-pulse rounded bg-[#1E293B]" />
                                        </div>
                                    </div>
                                ))
                            ) : null}
                            {!isDashboardLoading ? (
                            <>
                            <div className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                <p className="font-semibold">Available Sheets</p>
                                <ul className="mt-2 space-y-1 text-sm text-[#94A3B8]">
                                    {(sheetSummary.templates || []).length === 0 ? <li>• No sheets available yet.</li> : (sheetSummary.templates || []).map((sheet) => (
                                        <li key={sheet.id} className="flex items-center justify-between gap-2">
                                            <span>• {sheet.title}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleQuickSheetCheckIn(sheet.id)}
                                                className="rounded border border-[#334155] px-2 py-1 text-xs transition hover:bg-[#1E293B]"
                                            >
                                                Check-in
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                <p className="font-semibold">Upcoming Reminders</p>
                                <ul className="mt-2 space-y-1 text-sm text-[#94A3B8]">
                                    {(sheetSummary.reminders || []).length === 0 ? (
                                        <li>• No reminders yet.</li>
                                    ) : (
                                        (sheetSummary.reminders || []).slice(0, 4).map((item) => (
                                            <li key={item.id}>• {item.sheetId} at {new Date(item.remindAt).toLocaleString()}</li>
                                        ))
                                    )}
                                </ul>
                            </div>
                            </> 
                            ) : null}
                        </div>
                    </div>
                </section>

                <section id="about" className="mx-auto w-full px-4 py-14 section-fade">
                    <div className="rounded-3xl border border-[#334155] bg-[linear-gradient(145deg,rgba(2,6,23,0.96),rgba(30,27,75,0.7))] p-6 md:p-8">
                        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#22D3EE]">About Sync Code</p>
                                <h2 className="mt-2 text-3xl font-bold">Built to make collaborative coding feel interview-real, fast, and focused.</h2>
                                <p className="mt-4 text-sm leading-7 text-[#94A3B8]">
                                    Sync Code combines shared editing, live presence, optional voice, curated problems, and contest-style workflows in one place—so teams can practice exactly like real coding rounds.
                                </p>
                                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                    {homeFeatureHighlights.map((feature, index) => (
                                        <div
                                            key={`about-${feature.title}`}
                                            className={`rounded-xl border px-4 py-3 text-sm transition duration-300 ${
                                                activeFeatureHighlight === index
                                                    ? 'border-[#22D3EE] bg-[#22D3EE]/10 shadow-[0_0_16px_rgba(34,211,238,0.25)]'
                                                    : 'border-[#334155] bg-[#0B1120]'
                                            }`}
                                        >
                                            <p className="font-semibold text-[#F8FAFC]">{feature.title}</p>
                                            <p className="mt-1 text-xs text-[#94A3B8]">{feature.points[0]} · {feature.points[1]}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h3 className="text-lg font-semibold">What developers say</h3>
                                <div className="mt-4 grid gap-4">
                                    {testimonials.map((quote, index) => (
                                        <blockquote
                                            key={quote}
                                            className={`relative overflow-hidden rounded-2xl border p-5 text-[#94A3B8] transition duration-500 ${activeStyle.cardBg} ${activeStyle.cardHover} ${activeTestimonialIndex === index ? 'border-[#22D3EE] shadow-[0_0_24px_rgba(34,211,238,0.35)]' : 'border-[#334155]'}`}
                                        >
                                            <span
                                                className={`pointer-events-none absolute inset-y-0 left-[-34%] w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.28),transparent)] transition-transform duration-700 ${activeTestimonialIndex === index ? 'translate-x-[300%]' : 'translate-x-0 opacity-0'}`}
                                            />
                                            “{quote}”
                                        </blockquote>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section id="cta" className="mx-auto w-full px-4 py-16 section-fade">
                    <div className="rounded-3xl border border-[#334155] bg-[#020617]/90 p-6 md:p-8">
                        <h2 className="text-center text-3xl font-bold">Start Coding Together Today</h2>
                        <div className="mx-auto mt-4 flex flex-wrap justify-center gap-4">
                            <button
                                type="button"
                                onClick={createNewRoom}
                                className={`rounded-xl px-7 py-3 font-semibold transition duration-200 ${activeStyle.ctaBtn}`}
                            >
                                Create Coding Room
                            </button>
                            {!currentUser && !authLoading ? (
                                <button
                                    type="button"
                                    onClick={() => setShowAuthModal(true)}
                                    className="rounded-xl border border-[#8B5CF6] px-7 py-3 font-semibold text-[#A78BFA] transition duration-200 hover:bg-[#8B5CF6]/10"
                                >
                                    Sign In / Create Account
                                </button>
                            ) : null}
                        </div>

                        <div className="mx-auto mt-10 w-full max-w-2xl rounded-2xl border border-[#334155] bg-[#020617] p-6">
                            {authLoading ? (
                                <p className="text-sm text-[#94A3B8]">Loading authentication...</p>
                            ) : !currentUser ? (
                                <div className="space-y-4">
                                    <p className="text-center text-sm text-[#94A3B8]">Sign in to access your dashboard, room controls and personalized recommendations.</p>
                                    <button
                                        type="button"
                                        onClick={() => { setAuthMode('signin'); setShowAuthModal(true); }}
                                        className="w-full rounded-xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-3 font-semibold transition hover:opacity-90"
                                    >
                                        Sign In
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { setAuthMode('signup'); setShowAuthModal(true); }}
                                        className="w-full rounded-xl border border-[#334155] px-4 py-3 font-semibold transition hover:bg-[#1E293B]"
                                    >
                                        Create Account
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleContinueAsGuest}
                                        className="w-full rounded-xl border border-[#22D3EE] px-4 py-3 font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10"
                                    >
                                        Continue as Guest
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                        <p className="font-semibold">{getDisplayName(currentUser)}</p>
                                        <p className="mt-1 text-sm text-[#94A3B8]">{currentUser.email || 'Signed in session'}</p>
                                        <button
                                            type="button"
                                            onClick={() => setShowChangePassword((prev) => !prev)}
                                            className="mt-3 w-full rounded-lg border border-[#334155] px-3 py-2 text-sm font-semibold transition hover:bg-[#1E293B]"
                                        >
                                            {showChangePassword ? 'Hide Change Password' : 'Change Password'}
                                        </button>
                                        {showChangePassword ? (
                                            <div className="mt-3 space-y-2 rounded-lg border border-[#334155] bg-[#020617] p-3">
                                                <input
                                                    type="password"
                                                    className="w-full rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]"
                                                    placeholder="Old password"
                                                    value={oldPassword}
                                                    onChange={(event) => setOldPassword(event.target.value)}
                                                />
                                                <input
                                                    type="password"
                                                    className="w-full rounded-lg border border-[#334155] bg-[#0B1120] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]"
                                                    placeholder="New password"
                                                    value={newPassword}
                                                    onChange={(event) => setNewPassword(event.target.value)}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleChangePassword}
                                                    disabled={isChangingPassword}
                                                    className="w-full rounded-lg bg-[#1E293B] px-3 py-2 text-sm font-semibold transition hover:bg-[#334155] disabled:opacity-50"
                                                >
                                                    {isChangingPassword ? 'Updating...' : 'Update Password'}
                                                </button>
                                            </div>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={handleLogout}
                                            className="mt-3 w-full rounded-lg border border-[#334155] px-3 py-2 text-sm font-semibold transition hover:bg-[#1E293B]"
                                        >
                                            Logout
                                        </button>
                                    </div>

                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]"
                                        placeholder="ROOM ID"
                                        value={roomId}
                                        onChange={(event) => setRoomId(event.target.value)}
                                    />
                                    <input
                                        type="text"
                                        className="w-full rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]"
                                        placeholder="USERNAME"
                                        value={username}
                                        onChange={(event) => setUsername(event.target.value)}
                                    />

                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <button type="button" onClick={joinRoom} className="rounded-xl bg-[#1E293B] px-4 py-3 font-semibold transition hover:bg-[#334155]">Join Room</button>
                                        <button type="button" onClick={createNewRoom} className="rounded-xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-3 font-semibold">Create New Room</button>
                                    </div>
                                    <button type="button" onClick={solveSolo} className="w-full rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 font-semibold transition hover:bg-[#1E293B]">
                                        Solve Solo (No Room)
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                <section id="footer" className="mx-auto w-full px-4 pb-12 section-fade">
                    <footer className="relative overflow-hidden rounded-[26px] border border-[#334155] bg-[linear-gradient(150deg,rgba(2,6,23,0.96),rgba(15,23,42,0.94))] p-5 md:p-6">
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,transparent,#6366F1,#8B5CF6,#22D3EE,transparent)] opacity-80" />

                        <div className="grid gap-4 lg:grid-cols-3">
                            <article className="rounded-2xl border border-[#334155] bg-[#0B1120]/85 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#6366F1] hover:shadow-[0_0_22px_rgba(99,102,241,0.22)]">
                                <div className="flex items-start gap-3">
                                    <span className="text-xl">⚡</span>
                                    <div>
                                        <h3 className="text-sm font-bold text-[#F8FAFC]">About Sync Code</h3>
                                        <p className="mt-2 text-xs leading-6 text-[#94A3B8]">
                                            A real-time collaborative coding environment built for developers — supporting live pair programming, technical interview practice, multi-language execution, and performance analytics.
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold">
                                            <span className="rounded-full border border-[#4F46E5]/50 bg-[#4F46E5]/12 px-2.5 py-1 text-[#A5B4FC]">React</span>
                                            <span className="rounded-full border border-[#4F46E5]/50 bg-[#4F46E5]/12 px-2.5 py-1 text-[#A5B4FC]">Socket.IO</span>
                                            <span className="rounded-full border border-[#4F46E5]/50 bg-[#4F46E5]/12 px-2.5 py-1 text-[#A5B4FC]">CodeMirror</span>
                                            <span className="rounded-full border border-[#4F46E5]/50 bg-[#4F46E5]/12 px-2.5 py-1 text-[#A5B4FC]">Node.js</span>
                                        </div>
                                    </div>
                                </div>
                            </article>

                            <article className="rounded-2xl border border-[#334155] bg-[#0B1120]/85 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#8B5CF6] hover:shadow-[0_0_22px_rgba(139,92,246,0.24)]">
                                <div className="flex items-start gap-3">
                                    <span className="text-xl">👨‍💻</span>
                                    <div>
                                        <h3 className="text-sm font-bold text-[#F8FAFC]">Built by Anuj Kumar</h3>
                                        <p className="mt-2 text-xs leading-6 text-[#94A3B8]">
                                            Full-stack developer passionate about real-time systems, developer tooling, and building experiences that make coding collaboration effortless.
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <a href="https://github.com/AnujYadav-1915" target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#8B5CF6]/50 bg-[#8B5CF6]/10 px-3 py-1 text-[11px] font-semibold text-[#C4B5FD] transition hover:bg-[#8B5CF6]/20">GitHub</a>
                                            <a href="https://www.linkedin.com/in/anuj-kumar-918415295/" target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#8B5CF6]/50 bg-[#8B5CF6]/10 px-3 py-1 text-[11px] font-semibold text-[#C4B5FD] transition hover:bg-[#8B5CF6]/20">LinkedIn</a>
                                        </div>
                                    </div>
                                </div>
                            </article>

                            <article className="rounded-2xl border border-[#334155] bg-[#0B1120]/85 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-[#22D3EE] hover:shadow-[0_0_22px_rgba(34,211,238,0.2)]">
                                <div className="flex items-start gap-3">
                                    <span className="text-xl">✉️</span>
                                    <div>
                                        <h3 className="text-sm font-bold text-[#F8FAFC]">Get in Touch</h3>
                                        <p className="mt-2 text-xs leading-6 text-[#94A3B8]">
                                            Have feedback, a feature request, or want to collaborate? Reach out directly.
                                        </p>
                                        <div className="mt-3 flex flex-col gap-2 text-[12px]">
                                            <a className="text-[#67E8F9] transition hover:text-[#A5F3FC]" href="mailto:anujyadav1112@gmail.com">anujyadav1112@gmail.com</a>
                                            <a className="text-[#67E8F9] transition hover:text-[#A5F3FC]" href="https://github.com/AnujYadav-1915/Realtime-Collaborative-Code-Editor-master" target="_blank" rel="noopener noreferrer">View Source on GitHub</a>
                                        </div>
                                    </div>
                                </div>
                            </article>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#334155] px-1 pt-3 text-xs text-[#94A3B8]">
                            <span>© {new Date().getFullYear()} Sync Code · Built with ❤️ by Anuj Kumar</span>
                            <span className="rounded-full border border-[#334155] bg-[#0B1120] px-2.5 py-1 text-[10px] font-semibold text-[#A5B4FC]">v2.0 · Real-time · Open Source</span>
                        </div>
                    </footer>
                </section>
            </main>

            {showAuthModal ? (
                <div
                    className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    onClick={() => setShowAuthModal(false)}
                >
                    <div
                        className="relative mx-4 w-full max-w-md overflow-y-auto rounded-2xl border border-[#334155] bg-[#020617] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.8)]"
                        style={{maxHeight: '90vh'}}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setShowAuthModal(false)}
                            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-[#334155] text-[#94A3B8] transition hover:border-[#8B5CF6] hover:text-white"
                        >
                            ✕
                        </button>
                        <h3 className="text-xl font-bold text-[#F8FAFC]">Welcome to Sync Code</h3>
                        <p className="mt-1 text-sm text-[#94A3B8]">Sign in or create an account to continue.</p>
                        <div className="mt-5 space-y-3">
                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setAuthMode('signin')}
                                    className={`flex-1 rounded-xl border px-4 py-2 font-semibold transition ${authMode === 'signin' ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#F8FAFC]' : 'border-[#334155] text-[#94A3B8]'}`}
                                >
                                    Sign In
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAuthMode('signup')}
                                    className={`flex-1 rounded-xl border px-4 py-2 font-semibold transition ${authMode === 'signup' ? 'border-[#8B5CF6] bg-[#8B5CF6]/20 text-[#F8FAFC]' : 'border-[#334155] text-[#94A3B8]'}`}
                                >
                                    Create Account
                                </button>
                            </div>
                            <input
                                type="email"
                                className="w-full rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]"
                                placeholder="Email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                            />
                            <input
                                type="password"
                                className="w-full rounded-xl border border-[#334155] bg-[#0B1120] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]"
                                placeholder="Password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                            />
                            {authMode === 'signin' ? (
                                <button type="button" onClick={() => { handleEmailLogin(); setShowAuthModal(false); }} className="w-full rounded-xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-3 font-semibold transition hover:opacity-90">Sign In</button>
                            ) : (
                                <button type="button" onClick={() => { handleEmailSignup(); setShowAuthModal(false); }} className="w-full rounded-xl bg-[linear-gradient(135deg,#6366F1,#8B5CF6)] px-4 py-3 font-semibold transition hover:opacity-90">Create Account</button>
                            )}
                            <button
                                type="button"
                                onClick={() => { setShowForgotPassword((prev) => !prev); setForgotPasswordOtp(''); }}
                                className="w-full rounded-xl border border-[#334155] px-4 py-2 text-sm font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10"
                            >
                                {showForgotPassword ? 'Hide Forgot Password' : 'Forgot Password?'}
                            </button>
                            {showForgotPassword ? (
                                <div className="space-y-3 rounded-xl border border-[#334155] bg-[#0B1120] p-4">
                                    <div className="space-y-2">
                                        <input type="email" className="w-full rounded-xl border border-[#334155] bg-[#020617] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]" placeholder="Registered email" value={forgotPasswordEmail} onChange={(e) => setForgotPasswordEmail(e.target.value)} />
                                        <input type="text" className="w-full rounded-xl border border-[#334155] bg-[#020617] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]" placeholder="OTP (from email)" value={forgotPasswordOtp} onChange={(e) => setForgotPasswordOtp(e.target.value)} />
                                        <input type="password" className="w-full rounded-xl border border-[#334155] bg-[#020617] px-4 py-3 text-sm outline-none transition focus:border-[#8B5CF6]" placeholder="New password" value={forgotPasswordNewPassword} onChange={(e) => setForgotPasswordNewPassword(e.target.value)} />
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <button type="button" onClick={handleForgotPasswordRequest} disabled={isForgotPasswordRequesting} className="rounded-xl border border-[#334155] px-4 py-3 text-sm font-semibold transition hover:bg-[#1E293B] disabled:opacity-50">{isForgotPasswordRequesting ? 'Sending...' : 'Send OTP'}</button>
                                            <button type="button" onClick={handleForgotPasswordReset} disabled={isForgotPasswordResetting} className="rounded-xl bg-[#1E293B] px-4 py-3 text-sm font-semibold transition hover:bg-[#334155] disabled:opacity-50">{isForgotPasswordResetting ? 'Updating...' : 'Set New Password'}</button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                            {isFirebaseConfigured ? (
                                <>
                                    <div className="relative flex items-center gap-3 py-1"><span className="flex-1 border-t border-[#334155]"/><span className="text-xs text-[#94A3B8]">or</span><span className="flex-1 border-t border-[#334155]"/></div>
                                    <button type="button" onClick={handleGoogleSignIn} className="w-full rounded-xl border border-[#334155] px-4 py-3 font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10">Continue with Google</button>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <input type="text" className="sm:col-span-2 rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]" placeholder="Mobile (+91xxxxxxxxxx)" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
                                        <button type="button" onClick={handleSendOtp} className="rounded-xl border border-[#334155] px-3 py-2 text-sm font-semibold transition hover:bg-[#1E293B]">Send OTP</button>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <input type="text" className="sm:col-span-2 rounded-xl border border-[#334155] bg-[#0B1120] px-3 py-2 text-sm outline-none transition focus:border-[#8B5CF6]" placeholder="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} />
                                        <button type="button" onClick={handleVerifyOtp} className="rounded-xl border border-[#334155] px-3 py-2 text-sm font-semibold transition hover:bg-[#1E293B]">Verify OTP</button>
                                    </div>
                                    <div id="otp-recaptcha" />
                                </>
                            ) : null}
                            <button type="button" onClick={() => { handleContinueAsGuest(); setShowAuthModal(false); }} className="w-full rounded-xl border border-[#22D3EE] px-4 py-2 text-sm font-semibold text-[#22D3EE] transition hover:bg-[#22D3EE]/10">Continue as Guest</button>
                        </div>
                    </div>
                </div>
            ) : null}

        </div>
    );
};

export default Home;
