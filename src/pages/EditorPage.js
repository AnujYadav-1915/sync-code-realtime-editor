import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useRecoilState } from "recoil";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { cmtheme, language } from "../../src/atoms";
import { EmailAuthProvider, reauthenticateWithCredential, signOut, updatePassword } from "firebase/auth";
import ACTIONS from "../actions/Actions";
import Client from "../components/Client";
import Editor from "../components/Editor";
import ProblemBrowser from "../components/ProblemBrowser";
import { auth } from "../firebase";
import { initSocket } from "../socket";

const createDefaultRoomState = () => ({
  ownerUsername: "",
  latestCode: "",
  problem: {
    title: "",
    statement: "",
    targetTimeComplexity: "",
    targetSpaceComplexity: "",
    timeLimitMs: 2000,
    memoryLimitKb: 131072,
    visibleTestCasesText: "",
    hiddenTestCasesText: "",
  },
  timer: {
    durationSeconds: 1800,
    startedAt: null,
  },
  submissions: [],
});

const mergeRoomState = (currentState, updates = {}) => ({
  ...currentState,
  ...updates,
  problem: {
    ...currentState.problem,
    ...(updates.problem || {}),
  },
  timer: {
    ...currentState.timer,
    ...(updates.timer || {}),
  },
  submissions: updates.submissions || currentState.submissions,
});

const formatTestCases = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return "";
  }

  return JSON.stringify(value, null, 2);
};

const parseTestCasesText = (value, label) => {
  if (!value || !value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }

  return parsed.map((item) => ({
    input: item?.input ?? "",
    output: item?.output ?? "",
  }));
};

const formatTimestamp = (value) => {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleTimeString();
};

const parseExecutionTimeMs = (value) => {
  if (!value || value === "N/A") {
    return null;
  }

  const matched = `${value}`.match(/([0-9]+(?:\.[0-9]+)?)s/i);
  if (!matched) {
    return null;
  }

  return Math.round(Number(matched[1]) * 1000);
};

const parseMemoryKb = (value) => {
  if (!value || value === "N/A") {
    return null;
  }

  const matched = `${value}`.match(/([0-9]+(?:\.[0-9]+)?)\s*KB/i);
  if (!matched) {
    return null;
  }

  return Math.round(Number(matched[1]));
};

const buildLineDiffRows = (primaryText = "", secondaryText = "") => {
  const primaryLines = `${primaryText}`.split("\n");
  const secondaryLines = `${secondaryText}`.split("\n");
  const total = Math.max(primaryLines.length, secondaryLines.length, 1);

  return Array.from({ length: total }, (_, index) => {
    const text = primaryLines[index] ?? "";
    const compare = secondaryLines[index] ?? "";
    return {
      key: `line-${index}`,
      text,
      changed: text !== compare,
    };
  });
};

const buildSparklinePoints = (values = [], width = 120, height = 30) => {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = Math.max(maxValue - minValue, 1);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  return values
    .map((value, index) => {
      const x = Math.round(index * stepX * 100) / 100;
      const y = Math.round((height - ((value - minValue) / range) * height) * 100) / 100;
      return `${x},${y}`;
    })
    .join(" ");
};

const sampleProblemTemplate = {
  title: "Two Sum of Two Inputs",
  statement:
    "Read two integers and print their sum. Solve it within the expected complexity.",
  targetTimeComplexity: "O(1)",
  targetSpaceComplexity: "O(1)",
  timeLimitMs: 2000,
  memoryLimitKb: 131072,
  timerDurationSeconds: 1800,
  visibleTestCases: [
    {
      input: "2\n3",
      output: "5",
    },
  ],
  hiddenTestCases: [
    {
      input: "100\n250",
      output: "350",
    },
  ],
};

const backendBaseUrl = process.env.REACT_APP_BACKEND_URL || "http://localhost:5001";
const USERNAME_PREF_STORAGE_KEY = "sync-code-username-pref";

const runtimeInstallCommandMap = {
  macos: {
    node: "brew install node",
    python3: "brew install python",
    bash: "brew install bash",
    "c++": "xcode-select --install",
    javac: "brew install openjdk",
    java: "brew install openjdk",
    php: "brew install php",
    go: "brew install go",
    Rscript: "brew install --cask r",
    rustc: "brew install rust",
    ruby: "brew install ruby",
    swift: "xcode-select --install",
  },
  linux: {
    node: "sudo apt update && sudo apt install -y nodejs npm",
    python3: "sudo apt update && sudo apt install -y python3",
    bash: "sudo apt update && sudo apt install -y bash",
    "c++": "sudo apt update && sudo apt install -y g++",
    javac: "sudo apt update && sudo apt install -y openjdk-17-jdk",
    java: "sudo apt update && sudo apt install -y openjdk-17-jdk",
    php: "sudo apt update && sudo apt install -y php",
    go: "sudo apt update && sudo apt install -y golang-go",
    Rscript: "sudo apt update && sudo apt install -y r-base",
    rustc: "sudo apt update && sudo apt install -y rustc cargo",
    ruby: "sudo apt update && sudo apt install -y ruby",
    swift: "Install Swift toolchain from swift.org for your distro",
  },
  windows: {
    node: "winget install OpenJS.NodeJS.LTS",
    python3: "winget install Python.Python.3.12",
    bash: "winget install Git.Git",
    "c++": "winget install Microsoft.VisualStudio.2022.BuildTools",
    javac: "winget install Oracle.JDK.21",
    java: "winget install Oracle.JDK.21",
    php: "winget install PHP.PHP",
    go: "winget install GoLang.Go",
    Rscript: "winget install RProject.R",
    rustc: "winget install Rustlang.Rustup",
    ruby: "winget install RubyInstallerTeam.Ruby",
    swift: "Use WSL for Swift development on Windows",
  },
};

const detectClientOs = () => {
  const platform = `${navigator.platform || ""}`.toLowerCase();
  const userAgent = `${navigator.userAgent || ""}`.toLowerCase();

  if (platform.includes("mac") || userAgent.includes("mac os")) {
    return "macos";
  }
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "windows";
  }
  return "linux";
};

const EditorPage = () => {
  const [lang, setLang] = useRecoilState(language);
  const [, setCmTheme] = useRecoilState(cmtheme);
  const [clients, setClients] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [runOutput, setRunOutput] = useState("Run your code to see output here.");
  const [editorSnapshot, setEditorSnapshot] = useState("");
  const [roomState, setRoomState] = useState(createDefaultRoomState());
  const [clockTick, setClockTick] = useState(Date.now());
  const [problemLibrary, setProblemLibrary] = useState([]);
  const [selectedLibraryProblemId, setSelectedLibraryProblemId] = useState("");
  const [isLoadingLibraryProblem, setIsLoadingLibraryProblem] = useState(false);
  const [showProblemBrowser, setShowProblemBrowser] = useState(false);
  const [personalPreviewProblem, setPersonalPreviewProblem] = useState(null);
  const [isLoadingPersonalPreview, setIsLoadingPersonalPreview] = useState(false);
  const [switchRequests, setSwitchRequests] = useState([]);
  const [pendingSwitchRequest, setPendingSwitchRequest] = useState(null);
  const [previewWindowState, setPreviewWindowState] = useState({
    x: Math.max((window.innerWidth || 1200) * 0.58, 640),
    y: 90,
    width: Math.min((window.innerWidth || 1200) * 0.34, 500),
    height: Math.min((window.innerHeight || 800) * 0.72, 620),
  });
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [complexityHint, setComplexityHint] = useState(null);
  const [outputPanelHeight, setOutputPanelHeight] = useState(280);
  const [isResizingOutput, setIsResizingOutput] = useState(false);
  const [executionMeta, setExecutionMeta] = useState({ time: "-", memory: "-" });
  const [runState, setRunState] = useState("idle");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isZenMode, setIsZenMode] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const [runtimeStatusByLanguage, setRuntimeStatusByLanguage] = useState({});
  const [runtimeInstallOs, setRuntimeInstallOs] = useState("auto");
  const [launchProblemHandled, setLaunchProblemHandled] = useState(false);
  const [hintHistory, setHintHistory] = useState([]);
  const [hintPenalty, setHintPenalty] = useState(0);
  const [isLoadingHint, setIsLoadingHint] = useState(false);
  const [aiReview, setAiReview] = useState(null);
  const [isLoadingAiReview, setIsLoadingAiReview] = useState(false);
  const [visualExplainers, setVisualExplainers] = useState(null);
  const [isLoadingExplainers, setIsLoadingExplainers] = useState(false);
  const [debugInsight, setDebugInsight] = useState(null);
  const [isLoadingDebugger, setIsLoadingDebugger] = useState(false);
  const [lastRunResults, setLastRunResults] = useState([]);
  const [solutionNote, setSolutionNote] = useState("");
  const [solutionVersions, setSolutionVersions] = useState([]);
  const [versionComparison, setVersionComparison] = useState(null);
  const [outputPanelTab, setOutputPanelTab] = useState("output");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const [submissionFilterStatus, setSubmissionFilterStatus] = useState("all");
  const [submissionFilterLanguage, setSubmissionFilterLanguage] = useState("all");
  const [nextRecommendedProblem, setNextRecommendedProblem] = useState(null);
  const [isLoadingNextRecommendation, setIsLoadingNextRecommendation] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [showWhiteboard, setShowWhiteboard] = useState(false);
  const [whiteboardStrokes, setWhiteboardStrokes] = useState([]);
  const [whiteboardColor, setWhiteboardColor] = useState("#8B5CF6");
  const [whiteboardBrushSize, setWhiteboardBrushSize] = useState(2);
  const [editorTheme, setEditorTheme] = useState(() => `${localStorage.getItem("editor-ui-theme") || "midnight"}`);
  const [customStdinInput, setCustomStdinInput] = useState("");
  const [customStdinExpected, setCustomStdinExpected] = useState("");
  const [editorUsername, setEditorUsername] = useState(() => {
    try {
      return `${localStorage.getItem(USERNAME_PREF_STORAGE_KEY) || ""}`.trim();
    } catch (_error) {
      return "";
    }
  });

  const socketRef = useRef(null);
  const codeRef = useRef(null);
  const problemInputRef = useRef(null);
  const editorInstanceRef = useRef(null);
  const editorSplitRef = useRef(null);
  const profileMenuRef = useRef(null);
  const runCodeShortcutRef = useRef(null);
  const whiteboardCanvasRef = useRef(null);
  const drawingStrokeRef = useRef(null);
  const isDrawingRef = useRef(false);
  const previewDragOriginRef = useRef({ x: 0, y: 0 });
  const previewResizeOriginRef = useRef({ x: 0, y: 0, width: 500, height: 620 });
  const location = useLocation();
  const { roomId } = useParams();
  const isReadOnlyView = location.pathname.startsWith("/room/") && location.pathname.endsWith("/view");
  const isRoomMode = Boolean(roomId);
  const isSoloMode = !isRoomMode;
  const reactNavigator = useNavigate();
  const spectatorUsername = useMemo(() => `Spectator-${Math.random().toString(36).slice(2, 7)}`, []);
  const sessionUsername = `${location.state?.username || location.state?.profile?.displayName || (isReadOnlyView ? spectatorUsername : "Solo User")}`.trim() || "Solo User";
  const profileName = isSoloMode ? (editorUsername || sessionUsername) : sessionUsername;
  const profileContact = location.state?.profile?.email || location.state?.profile?.phoneNumber || (isReadOnlyView ? "Read-only viewer" : "Authenticated");
  const activeUsername = `${isRoomMode ? sessionUsername : (editorUsername || sessionUsername)}`.trim() || "Solo User";
  const isExecuting = isRunning || isSubmitting;
  const submitAttempts = useMemo(
    () => (roomState.submissions || []).filter((submission) => submission?.attemptType === "submit"),
    [roomState.submissions]
  );

  const submissionLanguages = useMemo(
    () => ["all", ...new Set(submitAttempts.map((submission) => submission.language).filter(Boolean))],
    [submitAttempts]
  );

  const solvedCount = useMemo(
    () => new Set(submitAttempts.filter((s) => s.passed).map((s) => s.problemId || s.title || "unknown")).size,
    [submitAttempts]
  );

  const filteredSubmitAttempts = useMemo(() => {
    return submitAttempts.filter((submission) => {
      const statusMatched =
        submissionFilterStatus === "all" ||
        (submissionFilterStatus === "accepted" && submission.passed) ||
        (submissionFilterStatus === "failed" && !submission.passed);
      const languageMatched = submissionFilterLanguage === "all" || submission.language === submissionFilterLanguage;
      return statusMatched && languageMatched;
    });
  }, [submissionFilterLanguage, submissionFilterStatus, submitAttempts]);

  const performanceTrend = useMemo(() => {
    const recent = submitAttempts.slice(0, 5);
    if (recent.length === 0) {
      return null;
    }

    const passedCount = recent.filter((item) => item.passed).length;
    const passRate = Math.round((passedCount / recent.length) * 100);
    const timeValues = recent.map((item) => Number(item.executionTimeMs || 0)).filter((value) => value > 0);
    const memoryValues = recent.map((item) => Number(item.memoryKb || 0)).filter((value) => value > 0);
    const latest = recent[0];
    const previous = recent[1];
    let momentum = "stable";

    if (previous) {
      if (latest.passed && !previous.passed) {
        momentum = "up";
      } else if (!latest.passed && previous.passed) {
        momentum = "down";
      }
    }

    return {
      attempts: recent.length,
      passRate,
      avgTimeMs: timeValues.length > 0 ? Math.round(timeValues.reduce((sum, value) => sum + value, 0) / timeValues.length) : null,
      avgMemoryKb: memoryValues.length > 0 ? Math.round(memoryValues.reduce((sum, value) => sum + value, 0) / memoryValues.length) : null,
      momentum,
    };
  }, [submitAttempts]);

  const latestPerformancePoints = useMemo(() => {
    const latestTen = [...submitAttempts].slice(0, 10).reverse();
    return {
      time: latestTen.map((item) => Number(item.executionTimeMs || 0)).filter((value) => value > 0),
      memory: latestTen.map((item) => Number(item.memoryKb || 0)).filter((value) => value > 0),
    };
  }, [submitAttempts]);

  useEffect(() => {
    const editorThemeMap = {
      midnight: "material-darker",
      neon: "dracula",
      light: "3024-day",
      sepia: "mdn-like",
    };

    setCmTheme(editorThemeMap[editorTheme] || "material-darker");
    localStorage.setItem("editor-ui-theme", editorTheme);
  }, [editorTheme, setCmTheme]);

  useEffect(() => {
    if (!showWhiteboard || !whiteboardCanvasRef.current) {
      return;
    }

    const canvas = whiteboardCanvasRef.current;
    const context = canvas.getContext("2d");
    const pixelRatio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
    canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
    context.scale(pixelRatio, pixelRatio);
    context.clearRect(0, 0, rect.width, rect.height);
    context.lineCap = "round";
    context.lineJoin = "round";

    whiteboardStrokes.forEach((stroke) => {
      if (!stroke?.points || stroke.points.length < 2) {
        return;
      }

      context.beginPath();
      context.strokeStyle = stroke.color || "#8B5CF6";
      context.lineWidth = stroke.size || 2;
      context.moveTo(stroke.points[0].x, stroke.points[0].y);
      stroke.points.slice(1).forEach((point) => {
        context.lineTo(point.x, point.y);
      });
      context.stroke();
    });
  }, [showWhiteboard, whiteboardStrokes]);

  const getCanvasPoint = useCallback((event) => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const handleWhiteboardPointerDown = useCallback((event) => {
    if (isReadOnlyView) {
      return;
    }

    const initialStroke = {
      color: whiteboardColor,
      size: whiteboardBrushSize,
      points: [getCanvasPoint(event)],
    };

    isDrawingRef.current = true;
    drawingStrokeRef.current = initialStroke;
    setWhiteboardStrokes((prev) => [...prev, initialStroke]);
  }, [getCanvasPoint, isReadOnlyView, whiteboardBrushSize, whiteboardColor]);

  const handleWhiteboardPointerMove = useCallback((event) => {
    if (!isDrawingRef.current || !drawingStrokeRef.current) {
      return;
    }

    drawingStrokeRef.current.points.push(getCanvasPoint(event));
    setWhiteboardStrokes((prev) => [...prev.slice(0, -1), drawingStrokeRef.current]);
  }, [getCanvasPoint]);

  const handleWhiteboardPointerUp = useCallback(() => {
    if (!isDrawingRef.current || !drawingStrokeRef.current) {
      return;
    }

    isDrawingRef.current = false;
    drawingStrokeRef.current = null;

    if (isRoomMode) {
      socketRef.current?.emit(ACTIONS.WHITEBOARD_SYNC, {
        roomId,
        strokes: whiteboardStrokes,
      });
    }
  }, [isRoomMode, roomId, whiteboardStrokes]);

  const handleWhiteboardClear = useCallback(() => {
    if (isReadOnlyView) {
      return;
    }

    setWhiteboardStrokes([]);
    if (isRoomMode) {
      socketRef.current?.emit(ACTIONS.WHITEBOARD_CLEAR, { roomId });
    }
  }, [isReadOnlyView, isRoomMode, roomId]);

  const currentVerdict = useMemo(() => {
    if (runState === "running") {
      return isSubmitting ? "SUBMITTING" : "RUNNING";
    }

    if (runState === "success") {
      if (lastRunResults.length > 0 && lastRunResults.every((result) => result.passed)) {
        return "ACCEPTED";
      }
      return "ACCEPTED";
    }

    if (runState === "error") {
      const fullOutput = [
        runOutput,
        ...(lastRunResults || []).map((result) => `${result.actual || ""} ${result.expected || ""}`),
      ]
        .join(" ")
        .toLowerCase();

      if (/time\s*limit|timed\s*out|timeout|tle/.test(fullOutput)) {
        return "TLE";
      }

      if (/runtime|exception|traceback|segmentation|stack\s*overflow|syntaxerror|referenceerror|typeerror/.test(fullOutput)) {
        return "RUNTIME_ERROR";
      }

      if (lastRunResults.length > 0) {
        return "WRONG_ANSWER";
      }

      return "RUNTIME_ERROR";
    }

    return "NONE";
  }, [isSubmitting, lastRunResults, runOutput, runState]);

  const activeResult =
    lastRunResults.length > 0
      ? lastRunResults[Math.min(activeResultIndex, lastRunResults.length - 1)]
      : null;

  const activeResultDiff = useMemo(() => {
    if (!activeResult || activeResult.visibility !== "visible") {
      return null;
    }

    return {
      expectedRows: buildLineDiffRows(activeResult.expected || "", activeResult.actual || ""),
      actualRows: buildLineDiffRows(activeResult.actual || "", activeResult.expected || ""),
    };
  }, [activeResult]);

  const loadNextRecommendation = useCallback(async () => {
    const username = `${activeUsername || ""}`.trim();
    if (!username) {
      toast.error("Username is missing. Unable to load recommendations.");
      return;
    }

    setIsLoadingNextRecommendation(true);
    try {
      const params = new URLSearchParams({ username });
      const response = await fetch(`${backendBaseUrl}/api/recommendations?${params.toString()}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to fetch recommendations.");
      }

      const currentId = roomState.problem?.id || selectedLibraryProblemId || "";
      const groups = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
      let nextProblem = null;

      for (const group of groups) {
        const candidate = (group?.problems || []).find((problem) => problem?.id && problem.id !== currentId);
        if (candidate) {
          nextProblem = {
            ...candidate,
            topic: group?.topic || candidate.category,
          };
          break;
        }
      }

      if (!nextProblem) {
        const fallbackResponse = await fetch(`${backendBaseUrl}/api/problems?page=1&limit=20`);
        const fallbackPayload = await fallbackResponse.json();
        if (fallbackResponse.ok) {
          const fallbackProblems = Array.isArray(fallbackPayload?.problems) ? fallbackPayload.problems : [];
          const fallbackCandidate = fallbackProblems.find((problem) => problem?.id && problem.id !== currentId);
          if (fallbackCandidate) {
            nextProblem = {
              ...fallbackCandidate,
              topic: fallbackCandidate.category || "recommended",
            };
          }
        }
      }

      setNextRecommendedProblem(nextProblem);
      if (!nextProblem) {
        toast("No next recommendation available right now.", { icon: "ℹ️" });
      }
    } catch (_error) {
      setNextRecommendedProblem(null);
      toast.error("Failed to load recommendations.");
    } finally {
      setIsLoadingNextRecommendation(false);
    }
  }, [activeUsername, roomState.problem?.id, selectedLibraryProblemId]);

  const applyIncomingRoomState = (incomingState) => {
    if (typeof incomingState?.latestCode === "string") {
      codeRef.current = incomingState.latestCode;
      editorInstanceRef.current?.setCode(incomingState.latestCode);
    }

    setRoomState((prev) =>
      mergeRoomState(prev, {
        ...incomingState,
        problem: {
          ...(incomingState?.problem || {}),
          hiddenTestCasesText: prev.problem.hiddenTestCasesText,
        },
      })
    );
  };

  useEffect(() => {
    if (typeof roomState.latestCode === "string" && editorInstanceRef.current) {
      editorInstanceRef.current.setCode(roomState.latestCode);
      codeRef.current = roomState.latestCode;
    }
  }, [roomState.latestCode]);

  const updateRoomState = (updates, shouldBroadcast = true) => {
    setRoomState((prev) => {
      const nextState = mergeRoomState(prev, updates);
      if (shouldBroadcast && isRoomMode && roomId) {
        socketRef.current?.emit(ACTIONS.ROOM_STATE_UPDATE, {
          roomId,
          updates,
        });
      }
      return nextState;
    });
  };

  useEffect(() => {
    const timerId = setInterval(() => setClockTick(Date.now()), 1000);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!isResizingOutput) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      const splitRect = editorSplitRef.current?.getBoundingClientRect();
      if (!splitRect) {
        return;
      }

      const nextHeight = splitRect.bottom - event.clientY;
      const safeHeight = Math.min(Math.max(nextHeight, 140), 420);
      setOutputPanelHeight(safeHeight);
    };

    const handleMouseUp = () => {
      setIsResizingOutput(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingOutput]);

  useEffect(() => {
    if (!isDraggingPreview && !isResizingPreview) {
      return undefined;
    }

    const handleMouseMove = (event) => {
      if (isDraggingPreview) {
        setPreviewWindowState((prev) => ({
          ...prev,
          x: Math.max(12, event.clientX - previewDragOriginRef.current.x),
          y: Math.max(70, event.clientY - previewDragOriginRef.current.y),
        }));
        return;
      }

      if (isResizingPreview) {
        const nextWidth = Math.min(
          Math.max(360, previewResizeOriginRef.current.width + (event.clientX - previewResizeOriginRef.current.x)),
          Math.max(440, (window.innerWidth || 1200) * 0.46)
        );
        const nextHeight = Math.min(
          Math.max(360, previewResizeOriginRef.current.height + (event.clientY - previewResizeOriginRef.current.y)),
          Math.max(460, (window.innerHeight || 800) * 0.86)
        );
        setPreviewWindowState((prev) => ({
          ...prev,
          width: nextWidth,
          height: nextHeight,
        }));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingPreview(false);
      setIsResizingPreview(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingPreview, isResizingPreview]);

  useEffect(() => {
    document.body.classList.remove("theme-ocean", "theme-cyber");
    document.body.classList.add("theme-cyber");
    localStorage.setItem("ui-theme", "cyber");
  }, []);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return undefined;
    }

    const handleDocumentClick = (event) => {
      if (!profileMenuRef.current?.contains(event.target)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    const loadProblemLibrary = async () => {
      try {
        const response = await fetch(`${backendBaseUrl}/api/problems`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "Failed to fetch problem library.");
        }

        setProblemLibrary(Array.isArray(data?.problems) ? data.problems : []);
      } catch (error) {
        toast.error(error.message || "Failed to fetch problem library.");
      }
    };

    loadProblemLibrary();
  }, []);

  useEffect(() => {
    const loadRuntimeStatus = async () => {
      try {
        const response = await fetch(`${backendBaseUrl}/api/runtime-status`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "Failed to fetch runtime status.");
        }

        setRuntimeStatusByLanguage(data?.languageStatus || {});
      } catch (error) {
      }
    };

    loadRuntimeStatus();
  }, []);

  useEffect(() => {
    if (!isRoomMode) {
      return () => {};
    }

    const init = async () => {
      socketRef.current = await initSocket();
      socketRef.current.on("connect_error", handleErrors);
      socketRef.current.on("connect_failed", handleErrors);

      socketRef.current.emit(ACTIONS.JOIN, {
        roomId,
        username: activeUsername,
      });

      socketRef.current.on(ACTIONS.JOINED, ({ clients, username, socketId, roomState }) => {
        if (username !== activeUsername) {
          toast.success(`${username} joined the room.`);
        }

        setClients(clients);
        if (roomState) {
          applyIncomingRoomState(roomState);
        }

        socketRef.current.emit(ACTIONS.SYNC_CODE, {
          code: codeRef.current,
          socketId,
        });
      });

      socketRef.current.on(ACTIONS.ROOM_STATE_UPDATE, ({ roomState }) => {
        if (roomState) {
          applyIncomingRoomState(roomState);
        }
      });

      socketRef.current.on(ACTIONS.PRESENCE_UPDATE, ({ clients }) => {
        setClients(Array.isArray(clients) ? clients : []);
      });

      socketRef.current.on(ACTIONS.DISCONNECTED, ({ socketId, username }) => {
        toast.success(`${username} left the room.`);
        setClients((prev) => prev.filter((client) => client.socketId !== socketId));
      });

      socketRef.current.on(ACTIONS.JOIN_REJECTED, ({ reason }) => {
        toast.error(reason || "Unable to join room.");
        reactNavigator("/");
      });

      socketRef.current.on(ACTIONS.PROBLEM_SWITCH_REQUESTED, (request) => {
        setSwitchRequests((prev) => [request, ...prev].slice(0, 20));
        toast.success(`${request.requesterName} requested: ${request.title || request.problemId}`);
      });

      socketRef.current.on(ACTIONS.PROBLEM_SWITCH_RESPONSE, ({ decision, title }) => {
        if (decision === "pending") {
          toast("Switch request already pending approval.", { icon: "⏳" });
          return;
        }

        setPendingSwitchRequest(null);

        if (decision === "approved") {
          toast.success(`Host approved your switch request: ${title || "selected problem"}`);
          return;
        }
        toast.error(`Host rejected your switch request: ${title || "selected problem"}`);
      });

      socketRef.current.on(ACTIONS.WHITEBOARD_SYNC, ({ strokes }) => {
        setWhiteboardStrokes(Array.isArray(strokes) ? strokes : []);
      });

      socketRef.current.on(ACTIONS.WHITEBOARD_CLEAR, () => {
        setWhiteboardStrokes([]);
      });
    };

    const handleErrors = (error) => {
      console.log("socket error", error);
      toast.error("Socket connection failed, try again later.");
      reactNavigator("/");
    };

    init();

    return () => {
      socketRef.current?.off(ACTIONS.JOINED);
      socketRef.current?.off(ACTIONS.ROOM_STATE_UPDATE);
      socketRef.current?.off(ACTIONS.PRESENCE_UPDATE);
      socketRef.current?.off(ACTIONS.DISCONNECTED);
      socketRef.current?.off(ACTIONS.JOIN_REJECTED);
      socketRef.current?.off(ACTIONS.PROBLEM_SWITCH_REQUESTED);
      socketRef.current?.off(ACTIONS.PROBLEM_SWITCH_RESPONSE);
      socketRef.current?.off(ACTIONS.WHITEBOARD_SYNC);
      socketRef.current?.off(ACTIONS.WHITEBOARD_CLEAR);
      socketRef.current?.disconnect();
    };
  }, [activeUsername, isRoomMode, reactNavigator, roomId]);

  const remainingSeconds = useMemo(() => {
    const { durationSeconds, startedAt } = roomState.timer;
    if (!startedAt) {
      return durationSeconds;
    }

    const elapsedSeconds = Math.floor((clockTick - startedAt) / 1000);
    return Math.max(durationSeconds - elapsedSeconds, 0);
  }, [clockTick, roomState.timer]);

  const selectedRuntimeStatus = runtimeStatusByLanguage?.[lang] || null;
  const runtimeBadgeInfo = useMemo(() => {
    if (!selectedRuntimeStatus) {
      return {
        tone: "runtimeStatusNeutral",
        label: "Runtime status unavailable for this editor mode.",
      };
    }

    if (selectedRuntimeStatus.mode === "local") {
      if (selectedRuntimeStatus.localAvailable) {
        return {
          tone: "runtimeStatusOk",
          label: `Local runtime ready (${selectedRuntimeStatus.executionLanguage})`,
        };
      }

      return {
        tone: "runtimeStatusError",
        label: `Missing local runtime: ${selectedRuntimeStatus.missingBinaries.join(", ")}`,
      };
    }

    if (selectedRuntimeStatus.localAvailable) {
      return {
        tone: "runtimeStatusOk",
        label: `Local fallback ready (${selectedRuntimeStatus.executionLanguage})`,
      };
    }

    return {
      tone: "runtimeStatusWarn",
      label: `Remote execution mode. Missing local: ${selectedRuntimeStatus.missingBinaries.join(", ")}`,
    };
  }, [selectedRuntimeStatus]);

  const runtimeInstallCommands = useMemo(() => {
    if (!selectedRuntimeStatus?.missingBinaries?.length) {
      return [];
    }

    const detectedOs = detectClientOs();
    const selectedOsKey = runtimeInstallOs === "auto" ? detectedOs : runtimeInstallOs;
    const osCommands = runtimeInstallCommandMap[selectedOsKey] || runtimeInstallCommandMap.linux;

    const commands = selectedRuntimeStatus.missingBinaries
      .map((binaryName) => osCommands[binaryName])
      .filter(Boolean);

    return [...new Set(commands)];
  }, [selectedRuntimeStatus, runtimeInstallOs]);

  const runtimeInstallOsLabel = useMemo(() => {
    const detectedOs = detectClientOs();
    const selectedOsKey = runtimeInstallOs === "auto" ? detectedOs : runtimeInstallOs;
    if (selectedOsKey === "macos") return "macOS";
    if (selectedOsKey === "windows") return "Windows";
    return "Linux";
  }, [runtimeInstallOs]);

  const runtimeInstallAutoLabel = useMemo(() => {
    const detectedOs = detectClientOs();
    if (detectedOs === "macos") return "Auto (Detected: macOS)";
    if (detectedOs === "windows") return "Auto (Detected: Windows)";
    return "Auto (Detected: Linux)";
  }, []);

  const formattedRemainingTime = useMemo(() => {
    const minutes = `${Math.floor(remainingSeconds / 60)}`.padStart(2, "0");
    const seconds = `${remainingSeconds % 60}`.padStart(2, "0");
    return `${minutes}:${seconds}`;
  }, [remainingSeconds]);

  const isRoomCreator = isRoomMode && roomState.ownerUsername === activeUsername;
  const canEditProblem = (isSoloMode || isRoomCreator) && !isReadOnlyView;
  const editorThemeClass =
    editorTheme === "neon"
      ? "editorThemeNeon"
      : editorTheme === "light"
      ? "editorThemeLight"
      : editorTheme === "sepia"
      ? "editorThemeSepia"
      : "editorThemeMidnight";
  const readOnlyShareUrl = isRoomMode ? `${window.location.origin}/room/${roomId}/view` : "";
  const currentSocketId = socketRef.current?.id;
  const typingUsers = clients.filter((client) => client.isTyping && client.socketId !== currentSocketId);
  const typingLabel =
    typingUsers.length === 0
      ? ""
      : typingUsers.length === 1
      ? `${typingUsers[0].username} is typing...`
      : `${typingUsers[0].username} and ${typingUsers.length - 1} others are typing...`;

  async function copyRoomId() {
    try {
      await navigator.clipboard.writeText(roomId);
      toast.success("Room ID has been copied to clipboard");
    } catch (err) {
      toast.error("Could not copy the Room ID");
    }
  }

  function leaveRoom() {
    reactNavigator("/");
  }

  const handleCreateRoomFromSolo = async () => {
    if (!isSoloMode) {
      return;
    }

    const nextRoomId = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    try {
      const response = await fetch(`${backendBaseUrl}/api/rooms/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: nextRoomId }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to create room.");
      }

      toast.success("Room created. You are now in collaboration mode.");
      reactNavigator(`/editor/${nextRoomId}`, {
        state: {
          username: activeUsername,
          profile: location.state?.profile || {
            uid: `solo-${activeUsername}`,
            displayName: activeUsername,
            email: "",
            phoneNumber: "",
            photoURL: "",
          },
          selectedProblemId: selectedLibraryProblemId || roomState.problem?.id || undefined,
          selectedProblemTitle: roomState.problem?.title || undefined,
        },
      });
    } catch (error) {
      toast.error(error.message || "Failed to create room.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setIsProfileMenuOpen(false);
      reactNavigator("/");
    } catch (error) {
      toast.error(error.message || "Failed to logout.");
    }
  };

  const handleSaveEditorUsername = () => {
    if (isRoomMode) {
      toast("Username is fixed for active room sessions.", { icon: "ℹ️" });
      return;
    }

    const normalized = `${editorUsername || ""}`.trim();
    if (!normalized) {
      toast.error("Username cannot be empty.");
      return;
    }

    try {
      localStorage.setItem(USERNAME_PREF_STORAGE_KEY, normalized);
      toast.success("Username saved.");
    } catch (_error) {
      toast.error("Failed to save username.");
    }
  };

  const handleChangePassword = async () => {
    const email = `${location.state?.profile?.email || ""}`.trim().toLowerCase();

    if (!email) {
      toast.error("Email account required to change password.");
      return;
    }

    if (!oldPassword || !newPassword) {
      toast.error("Old and new password are required.");
      return;
    }

    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters.");
      return;
    }

    if (oldPassword === newPassword) {
      toast.error("New password must be different from old password.");
      return;
    }

    setIsChangingPassword(true);
    try {
      if (auth?.currentUser && auth.currentUser.email) {
        const credential = EmailAuthProvider.credential(email, oldPassword);
        await reauthenticateWithCredential(auth.currentUser, credential);
        await updatePassword(auth.currentUser, newPassword);
      } else {
        const response = await fetch(`${backendBaseUrl}/api/auth/change-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, oldPassword, newPassword }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to change password.");
        }
      }

      setOldPassword("");
      setNewPassword("");
      setShowChangePassword(false);
      toast.success("Password changed successfully.");
    } catch (error) {
      toast.error(error.message || "Failed to change password.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleCopyOutput = async () => {
    if (!runOutput) {
      toast.error("Output is empty.");
      return;
    }

    try {
      await navigator.clipboard.writeText(runOutput);
      toast.success("Output copied.");
    } catch (error) {
      toast.error("Failed to copy output.");
    }
  };

  const handleCopyInstallCommand = async (command) => {
    if (!command) {
      return;
    }

    try {
      await navigator.clipboard.writeText(command);
      toast.success("Install command copied.");
    } catch (error) {
      toast.error("Failed to copy command.");
    }
  };

  const handleClearOutput = () => {
    setRunOutput("Run your code to see output here.");
    setExecutionMeta({ time: "-", memory: "-" });
    setRunState("idle");
    setLastRunResults([]);
    setOutputPanelTab("output");
    setActiveResultIndex(0);
    setDebugInsight(null);
  };

  const currentProblemId = useMemo(() => {
    if (roomState.problem?.id) {
      return roomState.problem.id;
    }

    const normalizedTitle = `${roomState.problem?.title || "untitled-problem"}`
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    return normalizedTitle || "untitled-problem";
  }, [roomState.problem?.id, roomState.problem?.title]);

  useEffect(() => {
    setNextRecommendedProblem(null);
  }, [currentProblemId]);

  const loadSolutionVersions = useCallback(async () => {
    const username = activeUsername;
    if (!username || !currentProblemId) {
      return;
    }

    try {
      const params = new URLSearchParams({
        username,
        problemId: currentProblemId,
      });
      const response = await fetch(`${backendBaseUrl}/api/solution-notebook?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to load solution versions.");
      }

      setSolutionVersions(Array.isArray(data?.versions) ? data.versions : []);
    } catch (error) {
    }
  }, [activeUsername, currentProblemId]);

  useEffect(() => {
    loadSolutionVersions();
  }, [loadSolutionVersions]);

  const handleRevealNextHint = async () => {
    const username = activeUsername;
    if (!username) {
      toast.error("Sign in to use hints.");
      return;
    }

    setIsLoadingHint(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/problem-hints`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roomId: roomId || `solo-${activeUsername}`,
          code: codeRef.current || "",
          revealedCount: hintHistory.length,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to fetch hint.");
      }

      if (data?.done) {
        toast("All hints already revealed.", { icon: "🧠" });
        return;
      }

      if (data?.nextHint) {
        setHintHistory((prev) => [...prev, data.nextHint]);
      }
      setHintPenalty(Number(data?.suggestedPenalty) || hintPenalty);
    } catch (error) {
      toast.error(error.message || "Failed to reveal hint.");
    } finally {
      setIsLoadingHint(false);
    }
  };

  const handleGenerateAiReview = async () => {
    const currentCode = codeRef.current || "";
    if (!currentCode.trim()) {
      toast.error("Write code before generating review.");
      return;
    }

    setIsLoadingAiReview(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/code-review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: currentCode,
          complexityHint,
          runSummary: {
            allPassed: runState === "success",
            failedCount: (lastRunResults || []).filter((item) => !item.passed).length,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate AI review.");
      }

      setAiReview(data?.review || null);
    } catch (error) {
      toast.error(error.message || "Failed to generate AI review.");
    } finally {
      setIsLoadingAiReview(false);
    }
  };

  const handleGenerateExplainers = async () => {
    const currentCode = codeRef.current || "";
    if (!currentCode.trim()) {
      toast.error("Write code before generating explainers.");
      return;
    }

    let visibleCases = [];
    try {
      visibleCases = parseTestCasesText(roomState.problem.visibleTestCasesText, "Visible test cases");
    } catch (_error) {
      visibleCases = [];
    }

    const sampleCase = visibleCases[0] || { input: "", output: "" };

    setIsLoadingExplainers(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/visual-explainers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: currentCode,
          sampleInput: sampleCase.input || "",
          sampleOutput: sampleCase.output || "",
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate visual explainers.");
      }
      setVisualExplainers(data?.explainers || null);
    } catch (error) {
      toast.error(error.message || "Failed to generate visual explainers.");
    } finally {
      setIsLoadingExplainers(false);
    }
  };

  const handleGenerateDebugger = useCallback(async (incomingResults = lastRunResults) => {
    setIsLoadingDebugger(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/debug-run-failure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          results: incomingResults || [],
          complexityHint,
          output: runOutput,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to generate debugger insight.");
      }
      setDebugInsight(data?.debug || null);
    } catch (error) {
      toast.error(error.message || "Failed to generate debugger insight.");
    } finally {
      setIsLoadingDebugger(false);
    }
  }, [complexityHint, lastRunResults, runOutput]);

  const handleSaveSolutionVersion = async () => {
    const username = activeUsername;
    const currentCode = codeRef.current || "";
    if (!username) {
      toast.error("Sign in to save solution versions.");
      return;
    }
    if (!currentCode.trim()) {
      toast.error("Write code before saving version.");
      return;
    }

    try {
      const response = await fetch(`${backendBaseUrl}/api/solution-notebook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          problemId: currentProblemId,
          title: roomState.problem.title || "Solution Version",
          language: lang,
          code: currentCode,
          complexity: complexityHint
            ? `${complexityHint.estimatedTime}/${complexityHint.estimatedSpace}`
            : "",
          note: solutionNote,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save solution version.");
      }

      toast.success("Solution version saved.");
      setSolutionNote("");
      loadSolutionVersions();
    } catch (error) {
      toast.error(error.message || "Failed to save solution version.");
    }
  };

  const handleCompareLatestVersions = async () => {
    const username = activeUsername;
    if (!username || solutionVersions.length < 2) {
      toast.error("Need at least two versions to compare.");
      return;
    }

    const leftVersion = solutionVersions[1]?.id;
    const rightVersion = solutionVersions[0]?.id;
    if (!leftVersion || !rightVersion) {
      return;
    }

    try {
      const params = new URLSearchParams({
        username,
        problemId: currentProblemId,
        leftVersion,
        rightVersion,
      });
      const response = await fetch(`${backendBaseUrl}/api/solution-notebook/compare?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to compare versions.");
      }

      setVersionComparison(data?.comparison || null);
    } catch (error) {
      toast.error(error.message || "Failed to compare versions.");
    }
  };

  const handleToggleProblemBrowser = useCallback(() => {
    setShowProblemBrowser((prev) => !prev);
  }, []);

  const handleFocusEditor = useCallback(() => {
    editorInstanceRef.current?.focus?.();
  }, []);

  const updateEditorCode = useCallback((newCode) => {
    editorInstanceRef.current?.setCode(newCode);
    codeRef.current = newCode;
    if (isRoomMode && roomId) {
      socketRef.current?.emit(ACTIONS.CODE_CHANGE, {
        roomId,
        code: newCode,
      });
    }
  }, [isRoomMode, roomId]);

  const draftStorageKey = useMemo(() => {
    const identity = activeUsername || location.state?.profile?.uid || "member";
    return `sync-code:draft:${roomId || "solo"}:${identity}`;
  }, [activeUsername, location.state?.profile?.uid, roomId]);

  const handleSaveDraft = useCallback((showToast = true) => {
    try {
      const payload = {
        code: codeRef.current || "",
        language: lang,
        savedAt: Date.now(),
      };

      localStorage.setItem(draftStorageKey, JSON.stringify(payload));
      setLastDraftSavedAt(payload.savedAt);

      if (showToast) {
        toast.success("Draft saved.");
      }
    } catch (error) {
      if (showToast) {
        toast.error("Failed to save draft.");
      }
    }
  }, [draftStorageKey, lang]);

  const handleRestoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) {
        toast.error("No saved draft found.");
        return;
      }

      const draft = JSON.parse(raw);

      if (typeof draft.code === "string") {
        updateEditorCode(draft.code);
        setEditorSnapshot(draft.code);
      }

      if (typeof draft.language === "string" && draft.language) {
        setLang(draft.language);
      }

      setLastDraftSavedAt(typeof draft.savedAt === "number" ? draft.savedAt : Date.now());
      toast.success("Draft restored.");
    } catch (error) {
      toast.error("Draft is corrupted or unavailable.");
    }
  }, [draftStorageKey, setLang, updateEditorCode]);

  useEffect(() => {
    const raw = localStorage.getItem(draftStorageKey);
    if (!raw) {
      return;
    }

    try {
      const draft = JSON.parse(raw);
      if (typeof draft.savedAt === "number") {
        setLastDraftSavedAt(draft.savedAt);
      }
    } catch (error) {
      setLastDraftSavedAt(null);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    const autosaveTimer = setTimeout(() => {
      handleSaveDraft(false);
    }, 1400);

    return () => clearTimeout(autosaveTimer);
  }, [editorSnapshot, handleSaveDraft]);

  const handleProblemUpload = (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const parsed = JSON.parse(loadEvent.target?.result || "{}");
        if (isRoomMode && isRoomCreator) {
          socketRef.current?.emit(ACTIONS.HOST_SET_PROBLEM, {
            roomId,
            problemId: parsed.id || `uploaded-${Date.now()}`,
            title: parsed.title || "",
            description: parsed.statement || "",
            testCases: {
              visible: parsed.visibleTestCases || [],
              hidden: parsed.hiddenTestCases || [],
            },
            problem: parsed,
          });
          setSelectedLibraryProblemId(parsed.id || "");
          toast.success("Structured problem uploaded to shared room.");
        } else if (isSoloMode) {
          setSelectedLibraryProblemId(parsed.id || "");
          setRoomState((prev) =>
            mergeRoomState(prev, {
              problem: {
                id: parsed.id || prev.problem.id,
                title: parsed.title || prev.problem.title,
                statement: parsed.statement || prev.problem.statement,
                targetTimeComplexity: parsed.targetTimeComplexity || prev.problem.targetTimeComplexity,
                targetSpaceComplexity: parsed.targetSpaceComplexity || prev.problem.targetSpaceComplexity,
                timeLimitMs: Number(parsed.timeLimitMs) || prev.problem.timeLimitMs,
                memoryLimitKb: Number(parsed.memoryLimitKb) || prev.problem.memoryLimitKb,
                visibleTestCasesText: JSON.stringify(parsed.visibleTestCases || [], null, 2),
                hiddenTestCasesText: JSON.stringify(parsed.hiddenTestCases || [], null, 2),
              },
              timer: {
                ...prev.timer,
                durationSeconds: Number(parsed.timerDurationSeconds) || prev.timer.durationSeconds,
                startedAt: null,
              },
            })
          );
          toast.success("Problem uploaded for solo practice.");
        } else {
          setPersonalPreviewProblem({
            id: parsed.id || `uploaded-preview-${Date.now()}`,
            title: parsed.title || "Uploaded Problem",
            statement: parsed.statement || "",
            difficulty: parsed.difficulty || "medium",
            category: parsed.category || "other",
            targetTimeComplexity: parsed.targetTimeComplexity || "",
            visibleTestCases: Array.isArray(parsed.visibleTestCases) ? parsed.visibleTestCases : [],
          });
          toast.success("Uploaded JSON opened in your private preview.");
        }
      } catch (error) {
        toast.error("Problem JSON is invalid.");
      } finally {
        if (problemInputRef.current) {
          problemInputRef.current.value = "";
        }
      }
    };
    reader.readAsText(file);
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([JSON.stringify(sampleProblemTemplate, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sample-problem-template.json";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Sample problem template downloaded.");
  };

  const handleLoadProblemFromLibrary = useCallback(async (problemId) => {
    const targetId = problemId || selectedLibraryProblemId;

    if (isRoomMode && !isRoomCreator) {
      toast.error("Only the room creator can load a shared problem from library.");
      return false;
    }

    if (!targetId) {
      toast.error("Select a library problem first.");
      return false;
    }

    setIsLoadingLibraryProblem(true);

    try {
      const response = await fetch(`${backendBaseUrl}/api/problems/${targetId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Failed to load selected problem.");
      }

      const selectedProblem = data?.problem;
      if (!selectedProblem) {
        throw new Error("Selected problem data is unavailable.");
      }

      setSelectedLibraryProblemId(targetId);

      setRoomState((prev) =>
        mergeRoomState(prev, {
          problem: {
            id: targetId,
            title: selectedProblem.title || "",
            statement: selectedProblem.statement || "",
            targetTimeComplexity: selectedProblem.targetTimeComplexity || "",
            targetSpaceComplexity: selectedProblem.targetSpaceComplexity || "",
            timeLimitMs: Number(selectedProblem.timeLimitMs) || prev.problem.timeLimitMs,
            memoryLimitKb: Number(selectedProblem.memoryLimitKb) || prev.problem.memoryLimitKb,
            visibleTestCasesText: JSON.stringify(selectedProblem.visibleTestCases || [], null, 2),
            hiddenTestCasesText: JSON.stringify(selectedProblem.hiddenTestCases || [], null, 2),
          },
          timer: {
            ...prev.timer,
            durationSeconds: Number(selectedProblem.timerDurationSeconds) || prev.timer.durationSeconds,
            startedAt: null,
          },
        })
      );

      if (isRoomMode) {
        socketRef.current?.emit(ACTIONS.HOST_SET_PROBLEM, {
          roomId,
          problemId: targetId,
          title: selectedProblem.title || "",
          description: selectedProblem.statement || "",
          testCases: {
            visible: selectedProblem.visibleTestCases || [],
            hidden: selectedProblem.hiddenTestCases || [],
          },
          problem: selectedProblem,
        });
      }

      toast.success(isRoomMode ? `"${selectedProblem.title}" loaded from library.` : `"${selectedProblem.title}" loaded for solo practice.`);
      return true;
    } catch (error) {
      toast.error(error.message || "Failed to load selected problem.");
      return false;
    } finally {
      setIsLoadingLibraryProblem(false);
    }
  }, [isRoomCreator, isRoomMode, roomId, selectedLibraryProblemId]);

  useEffect(() => {
    const launchProblemId = location.state?.selectedProblemId;
    if (!launchProblemId || launchProblemHandled || !canEditProblem) {
      return;
    }

    setLaunchProblemHandled(true);
    setSelectedLibraryProblemId(launchProblemId);

    handleLoadProblemFromLibrary(launchProblemId).then((loaded) => {
      if (loaded) {
        toast.success(`Question ready: ${location.state?.selectedProblemTitle || launchProblemId}`);
      }
    });
  }, [
    canEditProblem,
    handleLoadProblemFromLibrary,
    launchProblemHandled,
    location.state?.selectedProblemId,
    location.state?.selectedProblemTitle,
  ]);

  const updateProblemField = (field, value) => {
    if (!canEditProblem) {
      return;
    }

    updateRoomState({
      problem: {
        [field]: value,
      },
    });
  };

  const visibleTestCaseItems = useMemo(() => {
    try {
      return parseTestCasesText(roomState.problem.visibleTestCasesText, "Visible test cases");
    } catch (_error) {
      return [];
    }
  }, [roomState.problem.visibleTestCasesText]);

  const setVisibleTestCasesFromItems = useCallback((items = []) => {
    const sanitized = items.map((item) => ({
      input: `${item?.input ?? ""}`,
      output: `${item?.output ?? ""}`,
    }));
    updateProblemField("visibleTestCasesText", JSON.stringify(sanitized, null, 2));
  }, [updateProblemField]);

  const handleAddVisibleTestCase = useCallback(() => {
    if (!canEditProblem) {
      return;
    }

    setVisibleTestCasesFromItems([...visibleTestCaseItems, { input: "", output: "" }]);
  }, [canEditProblem, setVisibleTestCasesFromItems, visibleTestCaseItems]);

  const handleUpdateVisibleTestCase = useCallback((index, field, value) => {
    if (!canEditProblem) {
      return;
    }

    const updated = visibleTestCaseItems.map((item, caseIndex) =>
      caseIndex === index ? { ...item, [field]: value } : item
    );
    setVisibleTestCasesFromItems(updated);
  }, [canEditProblem, setVisibleTestCasesFromItems, visibleTestCaseItems]);

  const handleRemoveVisibleTestCase = useCallback((index) => {
    if (!canEditProblem) {
      return;
    }

    const updated = visibleTestCaseItems.filter((_, caseIndex) => caseIndex !== index);
    setVisibleTestCasesFromItems(updated);
  }, [canEditProblem, setVisibleTestCasesFromItems, visibleTestCaseItems]);

  const handleJudgeCode = useCallback(async (mode = "run", options = {}) => {
    const currentCode = codeRef.current || "";
    if (!currentCode.trim()) {
      toast.error(`Write some code before ${mode === "submit" ? "submitting" : "running"}.`);
      return;
    }

    let visibleTestCases = [];
    let hiddenTestCases = [];

    try {
      visibleTestCases = Array.isArray(options.visibleTestCases)
        ? options.visibleTestCases
        : parseTestCasesText(roomState.problem.visibleTestCasesText, "Visible test cases");
      if (mode === "submit") {
        hiddenTestCases = Array.isArray(options.hiddenTestCases)
          ? options.hiddenTestCases
          : parseTestCasesText(roomState.problem.hiddenTestCasesText, "Hidden test cases");
      }
    } catch (error) {
      toast.error(error.message);
      setRunOutput(error.message);
      return;
    }

    if (mode === "submit") {
      setIsSubmitting(true);
      setRunOutput("Submitting to judge...");
    } else {
      setIsRunning(true);
      setRunOutput("Running sample test cases...");
    }
    setOutputPanelTab("output");
    setActiveResultIndex(0);
    setRunState("running");

    try {
      const response = await fetch(
        `${backendBaseUrl}/api/run`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roomId: roomId || `solo-${activeUsername}`,
            username: activeUsername,
            language: lang,
            code: currentCode,
            visibleTestCases,
            hiddenTestCases: mode === "submit" ? hiddenTestCases : [],
            timeLimitMs: roomState.problem.timeLimitMs,
            memoryLimitKb: roomState.problem.memoryLimitKb,
          }),
        }
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to run code.");
      }

      if (Array.isArray(data?.results) && data.results.length > 0) {
        setLastRunResults(data.results);
        const firstFailureIndex = data.results.findIndex((item) => !item.passed);
        setActiveResultIndex(firstFailureIndex >= 0 ? firstFailureIndex : 0);
        const resultSummary = data.results
          .map((item) => {
            if (item.visibility === "hidden") {
              return `Hidden testcase #${item.index}: ${item.passed ? "PASS" : "FAIL"}`;
            }

            return [
              `${mode === "submit" ? "Visible testcase" : "Sample testcase"} #${item.index}: ${item.passed ? "PASS" : "FAIL"}`,
              `Expected: ${item.expected}`,
              `Actual: ${item.actual}`,
            ].join("\n");
          })
          .join("\n\n");

        setRunOutput(resultSummary);

        if (mode === "submit") {
          const submission = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            username: activeUsername,
            language: lang,
            attemptType: "submit",
            passed: data.allPassed,
            passedCount: data.results.filter((item) => item.passed).length,
            totalCount: data.results.length,
            executionTimeMs: parseExecutionTimeMs(data?.executionMeta?.time),
            memoryKb: parseMemoryKb(data?.executionMeta?.memory),
            createdAt: new Date().toISOString(),
          };

          if (isRoomMode) {
            socketRef.current?.emit(ACTIONS.SUBMISSION_ADD, {
              roomId,
              submission,
            });
          } else {
            setRoomState((prev) =>
              mergeRoomState(prev, {
                submissions: [submission, ...(prev.submissions || [])],
              })
            );
          }
        }

        if (data.allPassed) {
          setRunState("success");
          toast.success(mode === "submit" ? "Accepted. All judge cases passed." : "Sample test cases passed.");
          setDebugInsight(null);
          if (mode === "submit") {
            loadNextRecommendation();
          }
        } else {
          setRunState("error");
          toast.error(mode === "submit" ? "Submission failed on judge cases." : "Sample test cases failed.");
          if (mode === "submit" && data?.debug) {
            setDebugInsight(data.debug);
          } else if (mode === "submit") {
            handleGenerateDebugger(data.results);
          }
        }
      } else {
        setRunState("success");
        setRunOutput(data?.output || "No output.");
        setLastRunResults([]);
        setActiveResultIndex(0);
      }

      if (data?.complexityHint) {
        setComplexityHint(data.complexityHint);
      }

      setExecutionMeta({
        time: data?.executionMeta?.time || "-",
        memory: data?.executionMeta?.memory || "-",
      });
    } catch (error) {
      setRunState("error");
      setRunOutput(error.message || `Failed to ${mode}.`);
      toast.error(error.message || `Failed to ${mode}.`);
    } finally {
      if (mode === "submit") {
        setIsSubmitting(false);
      } else {
        setIsRunning(false);
      }
    }
  }, [
    handleGenerateDebugger,
    lang,
    loadNextRecommendation,
    activeUsername,
    isRoomMode,
    roomId,
    roomState.problem.hiddenTestCasesText,
    roomState.problem.memoryLimitKb,
    roomState.problem.timeLimitMs,
    roomState.problem.visibleTestCasesText,
  ]);

  const handleRunCode = useCallback(() => handleJudgeCode("run"), [handleJudgeCode]);

  const handleSubmitCode = useCallback(() => handleJudgeCode("submit"), [handleJudgeCode]);

  const handleRunWithCustomStdin = useCallback(() => {
    if (!customStdinInput.trim()) {
      toast.error("Enter custom input before running.");
      return;
    }

    handleJudgeCode("run", {
      visibleTestCases: [
        {
          input: customStdinInput,
          output: customStdinExpected,
        },
      ],
    });
  }, [customStdinExpected, customStdinInput, handleJudgeCode]);

  runCodeShortcutRef.current = handleRunCode;

  useEffect(() => {
    const handleKeydown = (event) => {
      const isModifierPressed = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        if (showProblemBrowser) {
          setShowProblemBrowser(false);
          return;
        }

        if (personalPreviewProblem) {
          setPersonalPreviewProblem(null);
          return;
        }

        if (isProfileMenuOpen) {
          setIsProfileMenuOpen(false);
        }
      }

      const eventTarget = event.target;
      const isTypingTarget =
        eventTarget instanceof HTMLElement &&
        (eventTarget.closest(".CodeMirror") || ["INPUT", "TEXTAREA", "SELECT"].includes(eventTarget.tagName));

      if (!isTypingTarget && outputPanelTab === "output" && lastRunResults.length > 0) {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          setActiveResultIndex((prev) => Math.min(prev + 1, lastRunResults.length - 1));
          return;
        }

        if (event.key === "ArrowLeft") {
          event.preventDefault();
          setActiveResultIndex((prev) => Math.max(prev - 1, 0));
          return;
        }
      }

      if (isModifierPressed && event.key === "Enter") {
        event.preventDefault();
        runCodeShortcutRef.current?.();
        return;
      }

      if (isModifierPressed && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        handleSubmitCode();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "b") {
        event.preventDefault();
        handleToggleProblemBrowser();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "e") {
        event.preventDefault();
        handleFocusEditor();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === "s") {
        event.preventDefault();
        handleSaveDraft(true);
        return;
      }

      if (isModifierPressed && event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        handleRestoreDraft();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [
    handleFocusEditor,
    handleSubmitCode,
    handleToggleProblemBrowser,
    isProfileMenuOpen,
    lastRunResults.length,
    outputPanelTab,
    personalPreviewProblem,
    showProblemBrowser,
    handleSaveDraft,
    handleRestoreDraft,
  ]);

  const isTimerRunning = Boolean(roomState.timer.startedAt) && remainingSeconds > 0;

  const handleTimerStart = () => {
    if (!isRoomCreator) {
      toast.error("Only the room creator can manage the timer.");
      return;
    }
    // Pass only the changed field — mergeRoomState preserves the rest
    updateRoomState({ timer: { startedAt: Date.now() } });
  };

  const handleTimerReset = () => {
    if (!isRoomCreator) {
      toast.error("Only the room creator can manage the timer.");
      return;
    }
    updateRoomState({ timer: { startedAt: null } });
    toast("Timer reset.");
  };

  const handleOpenPersonalPreview = useCallback(async (problemId) => {
    if (!problemId) {
      return;
    }

    setIsLoadingPersonalPreview(true);
    try {
      const response = await fetch(`${backendBaseUrl}/api/problems/${problemId}`);
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Failed to fetch selected problem.");
      }

      setSelectedLibraryProblemId(problemId);
      setPersonalPreviewProblem(data?.problem || null);
      setShowProblemBrowser(false);
    } catch (error) {
      toast.error(error.message || "Failed to open personal preview.");
    } finally {
      setIsLoadingPersonalPreview(false);
    }
  }, []);

  const handleOpenRecommendedProblem = useCallback(async () => {
    if (!nextRecommendedProblem?.id) {
      return;
    }

    if (isSoloMode || isRoomCreator) {
      const loaded = await handleLoadProblemFromLibrary(nextRecommendedProblem.id);
      if (loaded) {
        toast.success(`Next challenge loaded: ${nextRecommendedProblem.title}`);
      }
      return;
    }

    await handleOpenPersonalPreview(nextRecommendedProblem.id);
    toast.success("Recommended problem opened in personal preview.");
  }, [handleLoadProblemFromLibrary, handleOpenPersonalPreview, isRoomCreator, isSoloMode, nextRecommendedProblem]);

  const handleRequestHostSwitch = () => {
    if (!personalPreviewProblem?.id) {
      toast.error("Select a preview problem first.");
      return;
    }

    if (pendingSwitchRequest) {
      toast("You already have a pending request with the host.", { icon: "⏳" });
      return;
    }

    const nextPendingRequest = {
      problemId: personalPreviewProblem.id,
      title: personalPreviewProblem.title,
      createdAt: Date.now(),
    };

    setPendingSwitchRequest(nextPendingRequest);

    socketRef.current?.emit(ACTIONS.PROBLEM_REQUEST_SWITCH, {
      roomId,
      problemId: personalPreviewProblem.id,
      requesterName: activeUsername,
      title: personalPreviewProblem.title,
    });
    toast.success("Request sent to host.");
  };

  const handleApproveSwitchRequest = async (request) => {
    if (!request?.requestId) {
      return;
    }

    const switched = await handleLoadProblemFromLibrary(request.problemId);
    if (!switched) {
      return;
    }
    socketRef.current?.emit(ACTIONS.PROBLEM_SWITCH_RESPONSE, {
      requestId: request.requestId,
      decision: "approved",
    });
    setSwitchRequests((prev) => prev.filter((item) => item.requestId !== request.requestId));
  };

  const handleRejectSwitchRequest = (requestId) => {
    if (!requestId) {
      return;
    }
    socketRef.current?.emit(ACTIONS.PROBLEM_SWITCH_RESPONSE, {
      requestId,
      decision: "rejected",
    });
    setSwitchRequests((prev) => prev.filter((item) => item.requestId !== requestId));
  };

  const handlePreviewDragStart = (event) => {
    previewDragOriginRef.current = {
      x: event.clientX - previewWindowState.x,
      y: event.clientY - previewWindowState.y,
    };
    setIsDraggingPreview(true);
  };

  const handlePreviewResizeStart = (event) => {
    event.preventDefault();
    event.stopPropagation();
    previewResizeOriginRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: previewWindowState.width,
      height: previewWindowState.height,
    };
    setIsResizingPreview(true);
  };

  if (isRoomMode && !location.state && !isReadOnlyView) {
    return <Navigate to="/" />;
  }

  return (
    <div className={`mainWrap editorPageLayout ${editorThemeClass}${isSidebarCollapsed ? " sidebarCollapsed" : ""}`}>
      <div className="aside">
        <div className="asideInner">
          <div className="logo">
            <div className="workspaceBrandRow">
              {!isSidebarCollapsed ? <><span className="workspaceBrandIcon" aria-hidden="true">⌘</span><span className="workspaceBrandTitle">SYNC CODE</span></> : null}
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className="sidebarCollapseBtn"
                title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                style={{marginLeft: isSidebarCollapsed ? 0 : 'auto'}}
              >
                {isSidebarCollapsed ? "›" : "‹"}
              </button>
            </div>
          </div>
          <div className="editorProfileMenuWrap" ref={profileMenuRef}>
            <div className="editorProfileCard">
              <div className="editorProfileInfo">
                <strong className="editorProfileName">{profileName}</strong>
                <span className="editorProfileEmail">{profileContact}</span>
                <span className="editorProfileSolved">✅ {solvedCount} solved</span>
              </div>
              <button
                className="editorProfileSettingsBtn"
                onClick={() => setIsProfileMenuOpen((prev) => !prev)}
                title="Profile settings"
              >
                ⚙
              </button>
            </div>
            {isProfileMenuOpen && (
              <div className="editorProfileMenuCard">
                <strong>{profileName}</strong>
                <span>{profileContact}</span>
                <div className="editorInlineForm">
                  <input
                    type="text"
                    placeholder="Username"
                    value={editorUsername}
                    onChange={(event) => setEditorUsername(event.target.value)}
                    disabled={isRoomMode}
                  />
                  <button
                    className="btn secondarySidebarBtn"
                    onClick={handleSaveEditorUsername}
                    disabled={isRoomMode}
                    title={isRoomMode ? "Change username on Home before joining room" : "Save username for solo mode"}
                  >
                    Save Username
                  </button>
                </div>
                <button
                  className="btn secondarySidebarBtn"
                  onClick={() => setShowChangePassword((prev) => !prev)}
                >
                  {showChangePassword ? "Hide Change Password" : "Change Password"}
                </button>
                {showChangePassword && (
                  <div className="editorInlineForm">
                    <input
                      type="password"
                      placeholder="Old password"
                      value={oldPassword}
                      onChange={(event) => setOldPassword(event.target.value)}
                    />
                    <input
                      type="password"
                      placeholder="New password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                    <button
                      className="btn secondarySidebarBtn"
                      onClick={handleChangePassword}
                      disabled={isChangingPassword}
                    >
                      {isChangingPassword ? "Updating..." : "Update Password"}
                    </button>
                  </div>
                )}
                <button className="btn secondarySidebarBtn" onClick={handleLogout}>Logout</button>
              </div>
            )}
          </div>
          {isRoomMode ? (
            <>
              <h3>Room Members ({clients.length})</h3>
              <div className="clientsList">
                {clients.map((client) => (
                  <Client
                    key={client.socketId}
                    username={client.username}
                    color={client.color}
                    isTyping={client.isTyping}
                    isOwner={client.username === roomState.ownerUsername}
                  />
                ))}
              </div>
            </>
          ) : (
            <h3>Solo Practice Mode</h3>
          )}
          {isRoomMode && isRoomCreator && (
            <div className="hostRequestsCard">
              <h4>Switch Requests ({switchRequests.length})</h4>
              {switchRequests.length === 0 ? (
                <p className="hostRequestsEmpty">No pending requests.</p>
              ) : (
                <div className="hostRequestsList">
                  {switchRequests.map((request) => (
                    <div key={request.requestId} className="hostRequestItem">
                      <div className="hostRequestText">
                        <strong>{request.requesterName}</strong>
                        <span>{request.title || request.problemId}</span>
                      </div>
                      <div className="hostRequestActions">
                        <button className="miniBtn" onClick={() => handleApproveSwitchRequest(request)}>Approve</button>
                        <button className="miniBtn secondaryMiniBtn" onClick={() => handleRejectSwitchRequest(request.requestId)}>Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="sidebarActionStack">
            <input
              type="file"
              accept=".json"
              style={{ display: "none" }}
              id="problemUpload"
              onChange={handleProblemUpload}
              ref={problemInputRef}
            />
            <button className="btn secondarySidebarBtn" onClick={() => document.getElementById("problemUpload").click()}>
              Upload Problem JSON
            </button>
            <div className="uploadProblemHint">
              {isSoloMode
                ? "Upload applies to your local solo workspace only."
                : isRoomCreator
                ? "Host upload sets the shared room problem for everyone."
                : "Member upload opens the problem only in your private preview."}
            </div>

            <div className="sidebarActionGap sidebarEditorEntryGap" />

            <button
              className="btn secondarySidebarBtn pbBrowseBtn"
              onClick={() => setShowProblemBrowser(true)}
            >
              📚 Browse Library
              {selectedLibraryProblemId && <span className="pbSelectedDot" />}
            </button>
            {selectedLibraryProblemId && (
              <div className="pbSelectedRow">
                <span className="pbSelectedLabel" title={selectedLibraryProblemId}>
                  {problemLibrary.find((p) => p.id === selectedLibraryProblemId)?.title || selectedLibraryProblemId}
                </span>
                {isSoloMode || (isRoomMode && isRoomCreator) ? (
                  <button
                    className="btn secondarySidebarBtn"
                    style={{ padding: "4px 10px", fontSize: "11px" }}
                    onClick={handleLoadProblemFromLibrary}
                    disabled={isLoadingLibraryProblem}
                    title={isSoloMode ? "Load this problem into your editor" : "Load this problem into room"}
                  >
                    {isLoadingLibraryProblem ? "Loading..." : isSoloMode ? "Load Problem" : "Set Shared →"}
                  </button>
                ) : isRoomMode ? (
                  <span className="pbSelectedMemberHint">Ask creator to set shared</span>
                ) : (
                  <span className="pbSelectedMemberHint">Loaded for solo practice</span>
                )}
              </div>
            )}

            <div className="sidebarActionGap" />

            <div className="sidebarEditorActions">
              <button
                className="btn sidebarRunBtn"
                onClick={handleRunCode}
                disabled={isExecuting || isReadOnlyView}
                title="Cmd/Ctrl + Enter · Run visible sample tests"
              >
                {isRunning ? "Running..." : "▶ Run Samples"}
              </button>
              <button
                className="btn sidebarSubmitBtn"
                onClick={handleSubmitCode}
                disabled={isExecuting || isReadOnlyView}
                title="Cmd/Ctrl + Shift + Enter · Submit to full judge"
              >
                {isSubmitting ? "Submitting..." : "⚡ Submit Judge"}
              </button>
              <div className="sidebarEditorActionsRow">
                <button className="btn sidebarMiniBtn" onClick={() => handleSaveDraft(true)} title="Cmd/Ctrl + S" disabled={isReadOnlyView}>
                  💾 Save Draft
                </button>
                <button className="btn sidebarMiniBtn" onClick={handleRestoreDraft} title="Cmd/Ctrl + Shift + R" disabled={isReadOnlyView}>
                  ↩ Restore
                </button>
              </div>
              {lastDraftSavedAt ? (
                <div className="draftSavedHint">{new Date(lastDraftSavedAt).toLocaleTimeString()}</div>
              ) : null}
            </div>

            <div className="sidebarFillerCard" aria-label="Session snapshot">
              <strong className="sidebarFillerTitle">Session Snapshot</strong>
              <div className="sidebarSnapshotGrid">
                <div className="sidebarSnapshotRow">
                  <span>Status</span>
                  <strong>{isReadOnlyView ? "Viewer" : isRoomMode ? "Live Room" : "Solo"}</strong>
                </div>
                <div className="sidebarSnapshotRow">
                  <span>Language</span>
                  <strong>{String(lang || "cpp").toUpperCase()}</strong>
                </div>
                <div className="sidebarSnapshotRow">
                  <span>Theme</span>
                  <strong>{`${editorTheme.charAt(0).toUpperCase()}${editorTheme.slice(1)}`}</strong>
                </div>
                <div className="sidebarSnapshotRow">
                  <span>Timer</span>
                  <strong>{formattedRemainingTime}</strong>
                </div>
                <div className="sidebarSnapshotRow">
                  <span>Online</span>
                  <strong>{isRoomMode ? `${Math.max(clients.length, 1)} users` : "1 user"}</strong>
                </div>
                <div className="sidebarSnapshotRow">
                  <span>Runtime</span>
                  <strong>{runtimeBadgeInfo.label}</strong>
                </div>
              </div>
            </div>

            <div className="sidebarUtilityActions">
              {isReadOnlyView ? <div className="viewerBadge">👀 Read-only Spectator Mode</div> : null}
              {nextRecommendedProblem ? (
                <div className="sidebarNextProblem">
                  <span className="sidebarNextLabel">Next up</span>
                  <span className="sidebarNextTitle">{nextRecommendedProblem.title}</span>
                  <div className="sidebarNextMeta">
                    <span>{nextRecommendedProblem.topic || nextRecommendedProblem.category}</span>
                    <span>{nextRecommendedProblem.difficulty || "medium"}</span>
                  </div>
                  <button className="btn sidebarMiniBtn" onClick={handleOpenRecommendedProblem} type="button">
                    {isRoomCreator ? "Load Next" : "Open Preview"}
                  </button>
                </div>
              ) : (
                <button
                  className="btn sidebarMiniBtn sidebarRecommendBtn"
                  onClick={loadNextRecommendation}
                  type="button"
                  disabled={isLoadingNextRecommendation || isReadOnlyView}
                >
                  {isLoadingNextRecommendation ? "Finding..." : "🎯 Recommend Next"}
                </button>
              )}
              <button className="btn sidebarMiniBtn" onClick={handleDownloadTemplate} disabled={isReadOnlyView}>
                📥 Download Template
              </button>
              <div className={`runtimeStatusBadge ${runtimeBadgeInfo.tone}`}>
                {runtimeBadgeInfo.label}
              </div>
              {runtimeInstallCommands.length > 0 ? (
                <div className="runtimeInstallPanel">
                  <div className="runtimeInstallHeaderRow">
                    <div className="runtimeInstallTitle">Missing runtime ({runtimeInstallOsLabel})</div>
                    <select
                      className="runtimeInstallOsSelect"
                      value={runtimeInstallOs}
                      onChange={(event) => setRuntimeInstallOs(event.target.value)}
                    >
                      <option value="auto">{runtimeInstallAutoLabel}</option>
                      <option value="macos">macOS</option>
                      <option value="linux">Linux</option>
                      <option value="windows">Windows</option>
                    </select>
                  </div>
                  {runtimeInstallCommands.map((command) => (
                    <div key={command} className="runtimeInstallRow">
                      <span className="runtimeInstallCommand">{command}</span>
                      <button
                        className="miniBtn runtimeCopyBtn"
                        onClick={() => handleCopyInstallCommand(command)}
                        type="button"
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              {isRoomMode ? (
                <div className="sidebarEditorActionsRow">
                  <button className="btn sidebarMiniBtn" onClick={copyRoomId}>📋 Copy ID</button>
                  <button className="btn sidebarMiniBtn sidebarLeaveBtn" onClick={leaveRoom}>Leave</button>
                </div>
              ) : (
                <button className="btn sidebarSubmitBtn" onClick={handleCreateRoomFromSolo} disabled={isReadOnlyView}>
                  🚀 Create Room
                </button>
              )}
              {isRoomMode ? (
                <button
                  className="btn sidebarMiniBtn"
                  onClick={async () => {
                    await navigator.clipboard.writeText(readOnlyShareUrl);
                    toast.success("Read-only room link copied.");
                  }}
                  title="Share this read-only spectator URL"
                >
                  🔗 Copy Read-only Link
                </button>
              ) : null}
            </div>

          </div>
        </div>
      </div>

      <div className={`editorWorkspace ${isZenMode ? "zenMode" : ""}`}>
        {!isZenMode && <div className="challengePanel">
          <div className="challengeHeader">
            <div className="challengeMain">
              <input
                className="challengeTitleInput"
                value={roomState.problem.title}
                onChange={(event) => updateProblemField("title", event.target.value)}
                placeholder="Problem title"
                disabled={!canEditProblem}
              />
              <textarea
                className="challengeStatement"
                value={roomState.problem.statement}
                onChange={(event) => updateProblemField("statement", event.target.value)}
                placeholder="Paste or write the full problem statement here"
                disabled={!canEditProblem}
              />
            </div>

            <div className="challengeMetaGrid">
              <label className="metaField">
                Target Time Complexity
                <input
                  value={roomState.problem.targetTimeComplexity}
                  onChange={(event) => updateProblemField("targetTimeComplexity", event.target.value)}
                  placeholder="O(n log n)"
                  disabled={!canEditProblem}
                />
              </label>
              <label className="metaField">
                Target Space Complexity
                <input
                  value={roomState.problem.targetSpaceComplexity}
                  onChange={(event) => updateProblemField("targetSpaceComplexity", event.target.value)}
                  placeholder="O(1)"
                  disabled={!canEditProblem}
                />
              </label>
              <label className="metaField">
                Time Limit (ms)
                <input
                  type="number"
                  min="100"
                  value={roomState.problem.timeLimitMs}
                  onChange={(event) => updateProblemField("timeLimitMs", Number(event.target.value) || 0)}
                  disabled={!canEditProblem}
                />
              </label>
              <label className="metaField">
                Memory Limit (KB)
                <input
                  type="number"
                  min="1024"
                  value={roomState.problem.memoryLimitKb}
                  onChange={(event) => updateProblemField("memoryLimitKb", Number(event.target.value) || 0)}
                  disabled={!canEditProblem}
                />
              </label>
              {isRoomMode ? (
                <>
                  <label className="metaField">
                    Timer Duration (sec)
                    <input
                      type="number"
                      min="30"
                      value={roomState.timer.durationSeconds}
                      onChange={(event) =>
                        updateRoomState({
                          timer: {
                            durationSeconds: Number(event.target.value) || 0,
                          },
                        })
                      }
                      disabled={!canEditProblem}
                    />
                  </label>
                  <div className="timerCard">
                    <div className="timerCardHeader">
                      <span>Room Timer</span>
                      <span className={`timerStatusDot ${isTimerRunning ? "running" : "stopped"}`}>
                        {isTimerRunning ? "● Running" : remainingSeconds === 0 ? "⏰ Time's up" : "○ Stopped"}
                      </span>
                    </div>
                    <strong>{formattedRemainingTime}</strong>
                    <div className="timerActions">
                      <button
                        className="miniBtn"
                        onClick={handleTimerStart}
                        disabled={!isRoomCreator || isTimerRunning}
                        title={isTimerRunning ? "Timer is already running" : "Start the countdown"}
                      >
                        Start
                      </button>
                      <button
                        className="miniBtn secondaryMiniBtn"
                        onClick={handleTimerReset}
                        disabled={!isRoomCreator || !roomState.timer.startedAt}
                        title={!roomState.timer.startedAt ? "Timer hasn't been started yet" : "Stop and reset the timer"}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="challengeDetailsGrid">
            <div className="challengeBox">
              <div className="testCaseBuilderHeader">
                <h4>Visible Test Cases (Builder)</h4>
                <button className="miniBtn" onClick={handleAddVisibleTestCase} disabled={!canEditProblem}>+ Add Case</button>
              </div>
              <div className="testCaseBuilderList">
                {visibleTestCaseItems.length === 0 ? (
                  <p className="emptyStateText">No visible test cases yet. Add one to start.</p>
                ) : (
                  visibleTestCaseItems.map((item, index) => (
                    <div className="testCaseBuilderItem" key={`visible-builder-${index}`}>
                      <div className="testCaseBuilderItemHeader">
                        <strong>Case {index + 1}</strong>
                        <div className="testCaseBuilderActions">
                          <button
                            className="miniBtn"
                            onClick={() => handleJudgeCode("run", { visibleTestCases: [item] })}
                            disabled={isExecuting || isReadOnlyView}
                          >
                            Run this case
                          </button>
                          <button
                            className="miniBtn secondaryMiniBtn"
                            onClick={() => handleRemoveVisibleTestCase(index)}
                            disabled={!canEditProblem}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="testCaseBuilderGrid">
                        <label>
                          Input
                          <textarea
                            value={item.input}
                            onChange={(event) => handleUpdateVisibleTestCase(index, "input", event.target.value)}
                            placeholder={"6\\n3 4 5 6 7 8"}
                            disabled={!canEditProblem}
                          />
                        </label>
                        <label>
                          Expected Output
                          <textarea
                            value={item.output}
                            onChange={(event) => handleUpdateVisibleTestCase(index, "output", event.target.value)}
                            placeholder={"5"}
                            disabled={!canEditProblem}
                          />
                        </label>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="challengeBox">
              <h4>Hidden Judge Cases (JSON)</h4>
              <textarea
                value={roomState.problem.hiddenTestCasesText}
                onChange={(event) => updateProblemField("hiddenTestCasesText", event.target.value)}
                placeholder={'[{"input":"100\\n200","output":"300"}]'}
                disabled={!canEditProblem}
              />
            </div>
            <div className="challengeBox stdinBox">
              <h4>Custom Stdin Runner</h4>
              <textarea
                value={customStdinInput}
                onChange={(event) => setCustomStdinInput(event.target.value)}
                placeholder={"Enter custom stdin...\nExample:\n6\n3 4 5 6 7 8"}
                disabled={isReadOnlyView}
              />
              <textarea
                value={customStdinExpected}
                onChange={(event) => setCustomStdinExpected(event.target.value)}
                placeholder={"Optional expected output for validation"}
                disabled={isReadOnlyView}
              />
              <div className="timerActions" style={{ marginTop: "8px" }}>
                <button className="miniBtn" onClick={handleRunWithCustomStdin} disabled={isExecuting || isReadOnlyView}>Run custom input</button>
                <button className="miniBtn secondaryMiniBtn" onClick={() => { setCustomStdinInput(""); setCustomStdinExpected(""); }} disabled={isReadOnlyView}>
                  Clear
                </button>
              </div>
            </div>
            <div className="challengeBox submissionBox">
              <h4>Submission History (Submit only)</h4>
              <div className="submissionList">
                {submitAttempts.length === 0 ? (
                  <p className="emptyStateText">No submissions yet.</p>
                ) : (
                  submitAttempts.map((submission) => (
                    <div className={`submissionItem ${submission.passed ? "submissionPass" : "submissionFail"}`} key={submission.id}>
                      <strong>{submission.username}</strong>
                      <span>{submission.language}</span>
                      <span>{submission.passed ? "PASS" : "FAIL"}</span>
                      <span>{submission.passedCount}/{submission.totalCount} tests</span>
                      <span>{formatTimestamp(submission.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
            {isRoomMode ? <div className="challengeBox">
              <h4>Hint Ladder (Penalty: {hintPenalty})</h4>
              <button className="miniBtn" onClick={handleRevealNextHint} disabled={isLoadingHint}>
                {isLoadingHint ? "Loading..." : "Reveal Next Hint"}
              </button>
              <div className="submissionList" style={{ marginTop: "10px" }}>
                {hintHistory.length === 0 ? (
                  <p className="emptyStateText">No hints revealed yet.</p>
                ) : (
                  hintHistory.map((hint) => (
                    <div className="submissionItem" key={`${hint.level}-${hint.title}`}>
                      <strong>Step {hint.level}: {hint.title}</strong>
                      <span>{hint.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div> : null}
          </div>
        </div>}

        <div className="editorWrap">
          <div className="editorSplit" ref={editorSplitRef}>
            <div className="editorTopBar">
              <div className="editorTopLeft">
                <span className="editorTopTitle">EDITOR</span>
                {typingLabel ? <span className="typingIndicatorBadge">{typingLabel}</span> : null}
                <select
                  value={lang}
                  onChange={(event) => {
                    setLang(event.target.value);
                    window.location.reload();
                  }}
                  className="editorTopLangSelect"
                  title="Choose editor language"
                >
                  <option value="clike">C / C++ / C# / Java</option>
                  <option value="css">CSS</option>
                  <option value="dart">Dart</option>
                  <option value="django">Django</option>
                  <option value="dockerfile">Dockerfile</option>
                  <option value="go">Go</option>
                  <option value="htmlmixed">HTML-mixed</option>
                  <option value="javascript">JavaScript</option>
                  <option value="jsx">JSX</option>
                  <option value="markdown">Markdown</option>
                  <option value="php">PHP</option>
                  <option value="python">Python</option>
                  <option value="r">R</option>
                  <option value="rust">Rust</option>
                  <option value="ruby">Ruby</option>
                  <option value="sass">Sass</option>
                  <option value="shell">Shell</option>
                  <option value="sql">SQL</option>
                  <option value="swift">Swift</option>
                  <option value="xml">XML</option>
                  <option value="yaml">yaml</option>
                </select>
                <select
                  value={editorTheme}
                  onChange={(event) => setEditorTheme(event.target.value)}
                  className="editorTopLangSelect"
                  title="Choose editor visual theme"
                >
                  <option value="midnight">Midnight</option>
                  <option value="neon">Neon</option>
                  <option value="light">Light</option>
                  <option value="sepia">Sepia</option>
                </select>
                <button className="editorTopBtn" onClick={handleFocusEditor} title="Cmd/Ctrl + E">Focus</button>
                <button className="editorTopBtn" onClick={() => setIsZenMode((prev) => !prev)} title="Toggle focus mode">
                  {isZenMode ? "Standard" : "Zen"}
                </button>
                <button className="editorTopBtn" onClick={handleToggleProblemBrowser} title="Cmd/Ctrl + B">Library</button>
              </div>
              <div className="editorTopActions">
                <button
                  className={`editorTopBtn${isAiDrawerOpen ? " active" : ""}`}
                  onClick={() => setIsAiDrawerOpen((prev) => !prev)}
                  title="Toggle AI Tools drawer"
                  style={{marginRight: '8px', borderColor: isAiDrawerOpen ? '#8B5CF6' : ''}}
                >
                  🤖 AI Tools
                </button>
                <button className="editorTopBtn" onClick={handleCopyOutput} title="Copy current output to clipboard">Copy Out</button>
                <button className="editorTopBtn" onClick={handleClearOutput} title="Clear output panel">Clear Out</button>
                <button className={`editorTopBtn${showWhiteboard ? " active" : ""}`} onClick={() => setShowWhiteboard((prev) => !prev)} title="Toggle collaborative whiteboard">
                  📝 Whiteboard
                </button>
              </div>
            </div>
            <div className="editorCodeShell">
              <div className="editorPane">
                <Editor
                  ref={editorInstanceRef}
                  socketRef={socketRef}
                  roomId={roomId}
                  isRealtime={isRoomMode}
                  readOnly={isReadOnlyView}
                  onCodeChange={(code) => {
                    codeRef.current = code;
                    setEditorSnapshot(code);
                  }}
                />
              </div>
              {showWhiteboard ? (
                <div className="whiteboardPane">
                  <div className="whiteboardToolbar">
                    <span>Collaborative Whiteboard</span>
                    <div>
                      <input type="color" value={whiteboardColor} onChange={(event) => setWhiteboardColor(event.target.value)} disabled={isReadOnlyView} />
                      <input
                        type="range"
                        min="1"
                        max="8"
                        value={whiteboardBrushSize}
                        onChange={(event) => setWhiteboardBrushSize(Number(event.target.value) || 2)}
                        disabled={isReadOnlyView}
                      />
                      <button className="miniBtn secondaryMiniBtn" onClick={handleWhiteboardClear} disabled={isReadOnlyView}>Clear</button>
                    </div>
                  </div>
                  <canvas
                    ref={whiteboardCanvasRef}
                    className="whiteboardCanvas"
                    onPointerDown={handleWhiteboardPointerDown}
                    onPointerMove={handleWhiteboardPointerMove}
                    onPointerUp={handleWhiteboardPointerUp}
                    onPointerLeave={handleWhiteboardPointerUp}
                  />
                </div>
              ) : null}
            </div>

            <div className="outputResizer" onMouseDown={() => setIsResizingOutput(true)} />

            <div className={`executionOutputPanel ${runState}`} style={{ height: `${outputPanelHeight}px` }}>
              <div className="executionOutputHeader">
                <div className="outputHeaderLeft">
                  <div className="outputTabs" role="tablist" aria-label="Output tabs">
                    <button
                      className={`outputTabBtn ${outputPanelTab === "output" ? "active" : ""}`}
                      onClick={() => setOutputPanelTab("output")}
                      role="tab"
                      aria-selected={outputPanelTab === "output"}
                    >
                      Output
                    </button>
                    <button
                      className={`outputTabBtn ${outputPanelTab === "testcases" ? "active" : ""}`}
                      onClick={() => setOutputPanelTab("testcases")}
                      role="tab"
                      aria-selected={outputPanelTab === "testcases"}
                    >
                      Test Cases
                    </button>
                    <button
                      className={`outputTabBtn ${outputPanelTab === "submissions" ? "active" : ""}`}
                      onClick={() => setOutputPanelTab("submissions")}
                      role="tab"
                      aria-selected={outputPanelTab === "submissions"}
                    >
                      Submissions
                    </button>
                  </div>
                  <div className="verdictBadgeRow" aria-label="Judge verdict badges">
                    <span className={`verdictBadge ${currentVerdict === "ACCEPTED" ? "isActive accepted" : ""}`}>✅ Accepted</span>
                    <span className={`verdictBadge ${currentVerdict === "WRONG_ANSWER" ? "isActive wrong" : ""}`}>❌ Wrong Answer</span>
                    <span className={`verdictBadge ${currentVerdict === "TLE" ? "isActive tle" : ""}`}>⏱️ TLE</span>
                    <span className={`verdictBadge ${currentVerdict === "RUNTIME_ERROR" ? "isActive runtime" : ""}`}>💥 Runtime Error</span>
                  </div>
                </div>
                <div className="executionMetaWrap">
                  <span>Execution Time: {executionMeta.time}</span>
                  <span>Memory Used: {executionMeta.memory}</span>
                </div>
              </div>
              {outputPanelTab === "submissions" ? (
                <div className="outputSubmissionList">
                  {performanceTrend ? (
                    <div className="performanceTrendCard">
                      <div>
                        <strong>Last {performanceTrend.attempts} submits</strong>
                        <span>Pass Rate: {performanceTrend.passRate}%</span>
                      </div>
                      <div>
                        <span>
                          Avg Time: {performanceTrend.avgTimeMs ? `${performanceTrend.avgTimeMs}ms` : "N/A"}
                        </span>
                        <span>
                          Avg Memory: {performanceTrend.avgMemoryKb ? `${performanceTrend.avgMemoryKb}KB` : "N/A"}
                        </span>
                      </div>
                      <div className="performanceGraphWrap">
                        <span className={`performanceMomentum ${performanceTrend.momentum}`}>
                          {performanceTrend.momentum === "up" ? "↗ Improving" : performanceTrend.momentum === "down" ? "↘ Regressed" : "→ Stable"}
                        </span>
                        {latestPerformancePoints.time.length > 1 ? (
                          <svg viewBox="0 0 120 30" className="sparklineSvg" aria-label="Execution time trend">
                            <polyline points={buildSparklinePoints(latestPerformancePoints.time, 120, 30)} className="sparklineTime" />
                          </svg>
                        ) : null}
                        {latestPerformancePoints.memory.length > 1 ? (
                          <svg viewBox="0 0 120 30" className="sparklineSvg" aria-label="Memory trend">
                            <polyline points={buildSparklinePoints(latestPerformancePoints.memory, 120, 30)} className="sparklineMemory" />
                          </svg>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="submissionFilterRow">
                    <div className="submissionFilterPills">
                      <button
                        className={`submissionFilterBtn ${submissionFilterStatus === "all" ? "active" : ""}`}
                        onClick={() => setSubmissionFilterStatus("all")}
                        type="button"
                      >
                        All
                      </button>
                      <button
                        className={`submissionFilterBtn ${submissionFilterStatus === "accepted" ? "active" : ""}`}
                        onClick={() => setSubmissionFilterStatus("accepted")}
                        type="button"
                      >
                        Accepted
                      </button>
                      <button
                        className={`submissionFilterBtn ${submissionFilterStatus === "failed" ? "active" : ""}`}
                        onClick={() => setSubmissionFilterStatus("failed")}
                        type="button"
                      >
                        Failed
                      </button>
                    </div>
                    <select
                      className="submissionLanguageSelect"
                      value={submissionFilterLanguage}
                      onChange={(event) => setSubmissionFilterLanguage(event.target.value)}
                    >
                      {submissionLanguages.map((languageOption) => (
                        <option key={languageOption} value={languageOption}>
                          {languageOption === "all" ? "All Languages" : languageOption}
                        </option>
                      ))}
                    </select>
                  </div>
                  {filteredSubmitAttempts.length === 0 ? (
                    <p className="emptyStateText">No submit attempts for selected filters.</p>
                  ) : (
                    filteredSubmitAttempts.map((submission) => (
                      <div className={`submissionItem ${submission.passed ? "submissionPass" : "submissionFail"}`} key={`output-${submission.id}`}>
                        <strong>{submission.passed ? "Accepted" : "Failed"}</strong>
                        <span>{submission.language}</span>
                        <span>{submission.passedCount}/{submission.totalCount} tests</span>
                        <span>{new Date(submission.createdAt).toLocaleString()}</span>
                      </div>
                    ))
                  )}
                </div>
              ) : outputPanelTab === "testcases" ? (
                <div className="testCasesTabPanel">
                  {lastRunResults.length === 0 ? (
                    <p className="emptyStateText">Run your code to see test case results.</p>
                  ) : (
                    <>
                      <div className="testcaseChipRow" aria-label="Test case results">
                        {lastRunResults.map((item, index) => (
                          <button
                            type="button"
                            key={`tc-${item.index}-${item.visibility}`}
                            className={`testcaseChip ${item.passed ? "pass" : "fail"} ${activeResultIndex === index ? "active" : ""}`}
                            onClick={() => setActiveResultIndex(index)}
                            title={item.visibility === "hidden" ? "Hidden judge testcase" : "Visible testcase"}
                          >
                            {item.visibility === "hidden" ? `H${item.index}` : `V${item.index}`}
                          </button>
                        ))}
                      </div>
                      <div className="chipKeyboardHint">Use ← / → to move between testcase chips.</div>
                      {activeResult ? (
                        <div className="testcaseDetailCard">
                          <div className="testcaseDetailHeader">
                            <strong>
                              {activeResult.visibility === "hidden" ? "Hidden" : "Visible"} testcase #{activeResult.index}
                            </strong>
                            <span className={`testcaseDetailStatus ${activeResult.passed ? "pass" : "fail"}`}>
                              {activeResult.passed ? "PASS" : "FAIL"}
                            </span>
                          </div>
                          {activeResult.visibility === "visible" ? (
                            <div className="testcaseDetailGrid">
                              <div>
                                <span>Expected</span>
                                <pre>
                                  {(activeResultDiff?.expectedRows || []).map((row) => (
                                    <span key={`exp-tc-${row.key}`} className={`diffLine ${row.changed ? "diffLineChanged" : ""}`}>
                                      {row.text || " "}
                                    </span>
                                  ))}
                                </pre>
                              </div>
                              <div>
                                <span>Actual</span>
                                <pre>
                                  {(activeResultDiff?.actualRows || []).map((row) => (
                                    <span key={`act-tc-${row.key}`} className={`diffLine ${row.changed ? "diffLineChanged" : ""}`}>
                                      {row.text || " "}
                                    </span>
                                  ))}
                                </pre>
                              </div>
                            </div>
                          ) : (
                            <div className="testcaseHiddenHint">Hidden judge case details are masked, just like LeetCode.</div>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <>
                  {lastRunResults.length > 0 ? (
                    <>
                      <div className="testcaseChipRow" aria-label="Test case results">
                        {lastRunResults.map((item, index) => (
                          <button
                            type="button"
                            key={`result-${item.index}-${item.visibility}`}
                            className={`testcaseChip ${item.passed ? "pass" : "fail"} ${activeResultIndex === index ? "active" : ""}`}
                            onClick={() => setActiveResultIndex(index)}
                            title={item.visibility === "hidden" ? "Hidden judge testcase" : "Visible testcase"}
                          >
                            {item.visibility === "hidden" ? `H${item.index}` : `V${item.index}`}
                          </button>
                        ))}
                      </div>
                      <div className="chipKeyboardHint">Use ← / → to move between testcase chips.</div>
                      {activeResult ? (
                        <div className="testcaseDetailCard">
                          <div className="testcaseDetailHeader">
                            <strong>
                              {activeResult.visibility === "hidden" ? "Hidden" : "Visible"} testcase #{activeResult.index}
                            </strong>
                            <span className={`testcaseDetailStatus ${activeResult.passed ? "pass" : "fail"}`}>
                              {activeResult.passed ? "PASS" : "FAIL"}
                            </span>
                          </div>
                          {activeResult.visibility === "visible" ? (
                            <div className="testcaseDetailGrid">
                              <div>
                                <span>Expected</span>
                                <pre>
                                  {(activeResultDiff?.expectedRows || []).map((row) => (
                                    <span key={`expected-${row.key}`} className={`diffLine ${row.changed ? "diffLineChanged" : ""}`}>
                                      {row.text || " "}
                                    </span>
                                  ))}
                                </pre>
                              </div>
                              <div>
                                <span>Actual</span>
                                <pre>
                                  {(activeResultDiff?.actualRows || []).map((row) => (
                                    <span key={`actual-${row.key}`} className={`diffLine ${row.changed ? "diffLineChanged" : ""}`}>
                                      {row.text || " "}
                                    </span>
                                  ))}
                                </pre>
                              </div>
                            </div>
                          ) : (
                            <div className="testcaseHiddenHint">Hidden judge case details are masked, just like LeetCode.</div>
                          )}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <pre>{runOutput}</pre>
                  )}
                </>
              )}
              <div className="complexityHintInline">
                {complexityHint ? (
                  <span>
                    Estimated {complexityHint.estimatedTime} / {complexityHint.estimatedSpace}
                  </span>
                ) : (
                  <span>No complexity hint yet.</span>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
      <footer className="editorPageFooterInfo" aria-label="App Footer">
        <div className="footerCard footerCardAbout" style={{ '--card-delay': '0s' }}>
          <div className="footerCardIcon">⚡</div>
          <div className="footerCardBody">
            <strong className="footerCardTitle">About Sync Code</strong>
            <p className="footerCardDesc">
              A real-time collaborative coding environment built for developers — supporting live pair programming,
              technical interview practice, multi-language execution, and performance analytics.
            </p>
            <div className="footerTags">
              <span>React</span>
              <span>Socket.IO</span>
              <span>CodeMirror</span>
              <span>Node.js</span>
            </div>
          </div>
        </div>

        <div className="footerCard footerCardFounder" style={{ '--card-delay': '0.1s' }}>
          <div className="footerCardIcon">👨‍💻</div>
          <div className="footerCardBody">
            <strong className="footerCardTitle">Built by Anuj Kumar</strong>
            <p className="footerCardDesc">
              Full-stack developer passionate about real-time systems, developer tooling, and building
              experiences that make coding collaboration effortless.
            </p>
            <div className="footerSocials">
              <a href="https://github.com/AnujYadav-1915" target="_blank" rel="noopener noreferrer" className="footerSocialLink">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                GitHub
              </a>
              <a href="https://linkedin.com/in/anuj-kumar" target="_blank" rel="noopener noreferrer" className="footerSocialLink">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                LinkedIn
              </a>
            </div>
          </div>
        </div>

        <div className="footerCard footerCardContact" style={{ '--card-delay': '0.2s' }}>
          <div className="footerCardIcon">✉️</div>
          <div className="footerCardBody">
            <strong className="footerCardTitle">Get in Touch</strong>
            <p className="footerCardDesc">Have feedback, a feature request, or want to collaborate? Reach out directly.</p>
            <div className="footerContactLinks">
              <a href="mailto:anujyadav1112@gmail.com" className="footerContactItem">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                anujyadav1112@gmail.com
              </a>
              <a href="https://github.com/AnujYadav-1915/Realtime-Collaborative-Code-Editor-master" target="_blank" rel="noopener noreferrer" className="footerContactItem">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                View Source on GitHub
              </a>
            </div>
          </div>
        </div>

        <div className="footerBottomBar">
          <span>© {new Date().getFullYear()} Sync Code · Built with ❤️ by Anuj Kumar</span>
          <span className="footerVersion">v2.0 · Real-time · Open Source</span>
        </div>
      </footer>
      {isAiDrawerOpen && (
        <div className="aiToolsDrawer" role="complementary" aria-label="AI Tools">
          <div className="aiToolsDrawerHeader">
            <span>AI Tools</span>
            <button type="button" className="aiDrawerCloseBtn" onClick={() => setIsAiDrawerOpen(false)} aria-label="Close AI Tools">✕</button>
          </div>
          <div className="advancedToolsGrid">
            <div className="advancedToolPane">
              <h4>AI Review &amp; Debugger</h4>
              <div className="timerActions" style={{ marginBottom: "8px" }}>
                <button className="miniBtn" onClick={handleGenerateAiReview} disabled={isLoadingAiReview}>
                  {isLoadingAiReview ? "Reviewing..." : "Generate Review"}
                </button>
                <button className="miniBtn secondaryMiniBtn" onClick={() => handleGenerateDebugger()} disabled={isLoadingDebugger}>
                  {isLoadingDebugger ? "Analyzing..." : "Why WA/TLE?"}
                </button>
              </div>
              {aiReview ? (
                <div className="submissionList">
                  <div className="submissionItem">
                    <strong>Overall: {aiReview.scores?.overall ?? "-"}/100</strong>
                    <span>Correctness: {aiReview.scores?.correctness ?? "-"}</span>
                    <span>Complexity: {aiReview.scores?.complexity ?? "-"}</span>
                    <span>Readability: {aiReview.scores?.readability ?? "-"}</span>
                    <span>Communication: {aiReview.scores?.communication ?? "-"}</span>
                  </div>
                  {(aiReview.improvements || []).slice(0, 3).map((item) => (
                    <div className="submissionItem" key={item}><span>{item}</span></div>
                  ))}
                </div>
              ) : (
                <p className="emptyStateText">Generate AI review after writing/running code.</p>
              )}
              {debugInsight ? (
                <div className="submissionList" style={{ marginTop: "8px" }}>
                  <div className="submissionItem submissionFail">
                    <strong>{debugInsight.probableCause}</strong>
                    <span>{debugInsight.summary}</span>
                    {(debugInsight.suggestions || []).slice(0, 2).map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="advancedToolPane">
              <h4>Visual Explainers &amp; Notebook</h4>
              <div className="timerActions" style={{ marginBottom: "8px" }}>
                <button className="miniBtn" onClick={handleGenerateExplainers} disabled={isLoadingExplainers}>
                  {isLoadingExplainers ? "Generating..." : "Generate Explainer"}
                </button>
                <button className="miniBtn secondaryMiniBtn" onClick={handleSaveSolutionVersion}>Save Version</button>
              </div>
              <textarea
                value={solutionNote}
                onChange={(event) => setSolutionNote(event.target.value)}
                placeholder="Version note: approach changes, tradeoffs, and complexity decisions"
                style={{ minHeight: "60px" }}
              />
              {visualExplainers ? (
                <div className="submissionList" style={{ marginTop: "8px" }}>
                  {(visualExplainers.memoryTimeline || []).map((item) => (
                    <div className="submissionItem" key={item}><span>{item}</span></div>
                  ))}
                </div>
              ) : null}
              <div className="submissionList" style={{ marginTop: "8px" }}>
                {solutionVersions.length === 0 ? (
                  <p className="emptyStateText">No solution versions saved.</p>
                ) : (
                  solutionVersions.slice(0, 4).map((version) => (
                    <div className="submissionItem" key={version.id}>
                      <strong>v{version.versionNumber}</strong>
                      <span>{version.complexity || "Complexity N/A"}</span>
                      <span>{formatTimestamp(version.createdAt)}</span>
                    </div>
                  ))
                )}
              </div>
              <button
                className="miniBtn"
                onClick={handleCompareLatestVersions}
                disabled={solutionVersions.length < 2}
                style={{ marginTop: "8px" }}
              >
                Compare Latest Two Versions
              </button>
              {versionComparison ? (
                <div className="submissionList" style={{ marginTop: "8px" }}>
                  {(versionComparison.summary || []).map((line) => (
                    <div className="submissionItem" key={line}><span>{line}</span></div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
      {showProblemBrowser && (
        <ProblemBrowser
          backendBaseUrl={backendBaseUrl}
          canSetShared={isRoomCreator}
          loadActionLabel={isSoloMode ? "Load Problem" : isRoomCreator ? "Set Room Problem" : "Open Preview"}
          loadActionTitle={isSoloMode ? "Load this problem into your editor" : isRoomCreator ? "Set as shared room problem" : "Open personal preview"}
          onSelect={(id) => setSelectedLibraryProblemId(id)}
          onLoad={async (id) => {
            if (isSoloMode || isRoomCreator) {
              const loaded = await handleLoadProblemFromLibrary(id);
              if (loaded) {
                setShowProblemBrowser(false);
              }
              return;
            }
            handleOpenPersonalPreview(id);
          }}
          onClose={() => setShowProblemBrowser(false)}
        />
      )}
      {personalPreviewProblem && isRoomMode && !isRoomCreator && (
        <div
          className="personalPreviewDrawer"
          role="dialog"
          aria-label="Personal problem preview"
          style={{
            left: `${previewWindowState.x}px`,
            top: `${previewWindowState.y}px`,
            width: `${previewWindowState.width}px`,
            height: `${previewWindowState.height}px`,
          }}
        >
          <div className="personalPreviewHeader" onMouseDown={handlePreviewDragStart}>
            <div>
              <span className="personalPreviewLabel">Personal Preview</span>
              <h4>{personalPreviewProblem.title}</h4>
            </div>
            <button className="pbCloseBtn" onClick={() => setPersonalPreviewProblem(null)}>✕</button>
          </div>
          <div className="personalPreviewMeta">
            <span>{(personalPreviewProblem.difficulty || "medium").toUpperCase()}</span>
            <span>{(personalPreviewProblem.category || "other").replace(/-/g, " ")}</span>
            <span>{personalPreviewProblem.targetTimeComplexity || "-"}</span>
          </div>
          <div className="personalPreviewBody">
            <p>{personalPreviewProblem.statement || "No statement available."}</p>
            <h5>Visible Test Cases</h5>
            <pre>{formatTestCases(personalPreviewProblem.visibleTestCases) || "[]"}</pre>
            <button className="previewRequestBtn" onClick={handleRequestHostSwitch} disabled={Boolean(pendingSwitchRequest)}>
              {pendingSwitchRequest ? "Request Pending..." : "Request Host to Switch Problem"}
            </button>
            {pendingSwitchRequest ? (
              <div className="personalPreviewHint">
                Pending: {pendingSwitchRequest.title || pendingSwitchRequest.problemId}
              </div>
            ) : null}
            <div className="personalPreviewHint">
              This preview is only visible to you. Ask the room creator to set this as the shared room problem.
            </div>
          </div>
          <div className="personalPreviewResizeHandle" onMouseDown={handlePreviewResizeStart} />
        </div>
      )}
      {isLoadingPersonalPreview && isRoomMode && !isRoomCreator ? <div className="personalPreviewLoading">Loading preview...</div> : null}
    </div>
  );
};

export default EditorPage;
