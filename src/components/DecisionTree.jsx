import { useState, useEffect, useRef } from "react";

const MIXED_WORKLOAD_VALUE = "Mixed workloads";
const PRIMARY_WORKLOAD_VALUES = [
  "Enterprise, mission-critical and AI/ML (training, feature stores, checkpoints)",
  "Databases and stateful app components incl. logs, app state, exports, CI/CD",
  "General-purpose file shares / team shares (incl. user data shares)",
  "Hybrid file services with Azure File Sync (on-prem cache handles performance; cloud tier for durability/scale)",
  "Infrequently accessed data / backup, archives retained online (compliance, historical data)",
];
const MIXED_WORKLOAD_PRESET = [10, 20, 20, 20, 30];

const COMMON_QUESTION_IDS = [
  "nas",
  "sourceProtocol",
  "workloadType",
  "sourceShareSizeTb",
  "sourceIops",
  "sourceThroughputMibps",
  "comfortFactor",
  "assessmentCriteria",
];
const SOURCE_DETAILS_QUESTION_IDS = [
  "region",
  "redundancy",
  "targetService",
  "blobAccessFrequency",
  "filesMediaType",
];
const BLOB_INPUT_QUESTION_IDS = [];
const FILES_INPUT_QUESTION_IDS = [];

const COMMON_DEFAULTS = {
  nas: "netapp",
  sourceProtocol: ["smb_v3"],
  workloadType: MIXED_WORKLOAD_VALUE,
  workloadTypeSelections: [...PRIMARY_WORKLOAD_VALUES, MIXED_WORKLOAD_VALUE],
  workloadDistribution: {
    "Enterprise, mission-critical and AI/ML (training, feature stores, checkpoints)": 10,
    "Databases and stateful app components incl. logs, app state, exports, CI/CD": 20,
    "General-purpose file shares / team shares (incl. user data shares)": 20,
    "Hybrid file services with Azure File Sync (on-prem cache handles performance; cloud tier for durability/scale)": 20,
    "Infrequently accessed data / backup, archives retained online (compliance, historical data)": 30,
  },
  sourceShareSizeTb: "1024",
  sourceIops: "1000",
  sourceThroughputMibps: "100",
  comfortFactor: "1.0",
  assessmentCriteria: "perf_based",
};

const SOURCE_DETAILS_DEFAULTS = {
  region: "eastus",
  redundancy: "lrs",
  targetService: ["blobs", "files"],
  blobAccessFrequency: "hot",
  filesMediaType: ["ssd", "hdd"],
  maximizeReadinessAcrossTargets: true,
};

const BLOB_INPUT_DEFAULTS = {
  blobWorkloadType: "appdata",
  blobAccessFrequency: "hot",
};

const FILES_INPUT_DEFAULTS = {
  filesMediaType: ["ssd", "hdd"],
};

/** Pull the first selectable value out of flat or grouped options. */
function getFirstValue(question) {
  if (!question.options?.length) return "";
  const first = question.options[0];
  return first.group !== undefined
    ? (first.items?.[0]?.value ?? "")
    : (first.value ?? "");
}

/** True if options are grouped { group, items } objects. */
function isGrouped(question) {
  return question.options?.length > 0 && question.options[0].group !== undefined;
}

/** Filter options by requiresAnswer conditions. */
function getVisibleOptions(options, answers) {
  return options.filter((opt) => {
    if (!opt.requiresAnswer) return true;
    return Object.entries(opt.requiresAnswer).every(
      ([qId, val]) => answers[qId] === val
    );
  });
}

/** Determine whether a question is visible given current answers. */
function isQuestionVisible(question, answers) {
  if (!question.showIf) return true;
  return Object.entries(question.showIf).every(([qId, condition]) => {
    const answer = answers[qId];
    if (condition !== null && typeof condition === "object" && "includes" in condition) {
      return Array.isArray(answer) && answer.includes(condition.includes);
    }
    return answer === condition;
  });
}

/** Resolve default values for multiselect questions. */
function getDefaultMultiValues(question) {
  return Array.isArray(question.defaultValues) ? question.defaultValues : [];
}

function getDefaultSelectValue(question) {
  return question?.defaultValue ?? "";
}

function isPositiveNumber(value) {
  if (value === "" || value === null || value === undefined) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/** Resolve a stored answer to a human-readable label. */
function resolveLabel(question, value) {
  if (!question.options) return String(value ?? "");
  const flat = isGrouped(question)
    ? question.options.flatMap((g) => g.items)
    : question.options;
  if (Array.isArray(value)) {
    return value.map((v) => flat.find((o) => o.value === v)?.label ?? v).join(", ");
  }
  return flat.find((o) => o.value === value)?.label ?? String(value ?? "");
}

function normalizeWorkloadState(sourceAnswers = {}) {
  const selectedWorkloadType = sourceAnswers.workloadType ?? COMMON_DEFAULTS.workloadType;
  const existingDistribution = sourceAnswers.workloadDistribution ?? {};
  const distribution = PRIMARY_WORKLOAD_VALUES.reduce((acc, value) => {
    const existing = Number(existingDistribution[value]);
    acc[value] = Number.isFinite(existing) ? existing : 0;
    return acc;
  }, {});

  if (!sourceAnswers.workloadDistribution) {
    if (selectedWorkloadType === MIXED_WORKLOAD_VALUE) {
      PRIMARY_WORKLOAD_VALUES.forEach((value, index) => {
        distribution[value] = MIXED_WORKLOAD_PRESET[index];
      });
    } else if (PRIMARY_WORKLOAD_VALUES.includes(selectedWorkloadType)) {
      distribution[selectedWorkloadType] = 100;
    }
  }

  const selectedFromDistribution = PRIMARY_WORKLOAD_VALUES.filter((value) => distribution[value] > 0);
  const hasMixed = Array.isArray(sourceAnswers.workloadTypeSelections)
    ? sourceAnswers.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)
    : selectedWorkloadType === MIXED_WORKLOAD_VALUE;
  const workloadTypeSelections = hasMixed
    ? [...new Set([...selectedFromDistribution, MIXED_WORKLOAD_VALUE])]
    : selectedFromDistribution;

  const dominantWorkload = PRIMARY_WORKLOAD_VALUES.reduce(
    (best, value) => (distribution[value] > (distribution[best] ?? -1) ? value : best),
    PRIMARY_WORKLOAD_VALUES[0]
  );

  return {
    workloadType: hasMixed ? MIXED_WORKLOAD_VALUE : (selectedWorkloadType || dominantWorkload),
    workloadTypeSelections: workloadTypeSelections.length > 0
      ? workloadTypeSelections
      : [COMMON_DEFAULTS.workloadType],
    workloadDistribution: distribution,
  };
}

function getWorkloadTotal(workloadDistribution = {}) {
  return PRIMARY_WORKLOAD_VALUES.reduce(
    (total, value) => total + (Number(workloadDistribution[value]) || 0),
    0
  );
}

function getDerivedWorkloadType(workloadTypeSelections = [], workloadDistribution = {}) {
  if (Array.isArray(workloadTypeSelections) && workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)) {
    return MIXED_WORKLOAD_VALUE;
  }

  const dominant = PRIMARY_WORKLOAD_VALUES.reduce(
    (best, value) => ((Number(workloadDistribution[value]) || 0) > (Number(workloadDistribution[best]) || -1) ? value : best),
    PRIMARY_WORKLOAD_VALUES[0]
  );

  return dominant || COMMON_DEFAULTS.workloadType;
}

function formatWorkloadSummary(workloadTypeSelections = [], workloadDistribution = {}) {
  const parts = PRIMARY_WORKLOAD_VALUES
    .filter((value) => Number(workloadDistribution[value]) > 0)
    .map((value) => `${value}: ${Number(workloadDistribution[value])}%`);

  if (Array.isArray(workloadTypeSelections) && workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)) {
    parts.push("Mixed workloads");
  }

  return parts.join(" | ");
}

function isMixedPresetDistribution(workloadDistribution = {}) {
  return PRIMARY_WORKLOAD_VALUES.every(
    (value, index) => Number(workloadDistribution[value] ?? 0) === MIXED_WORKLOAD_PRESET[index]
  );
}

export default function DecisionTree({ questions, onComplete }) {
  const commonQuestions = COMMON_QUESTION_IDS
    .map((id) => questions.find((q) => q.id === id))
    .filter(Boolean);
  const sourceDetailsQuestions = SOURCE_DETAILS_QUESTION_IDS
    .map((id) => questions.find((q) => q.id === id))
    .filter(Boolean);
  const blobInputQuestions = BLOB_INPUT_QUESTION_IDS
    .map((id) => questions.find((q) => q.id === id))
    .filter(Boolean);
  const filesInputQuestions = FILES_INPUT_QUESTION_IDS
    .map((id) => questions.find((q) => q.id === id))
    .filter(Boolean);

  const hasCommonStep = commonQuestions.length === COMMON_QUESTION_IDS.length;
  const hasSourceDetailsStep = sourceDetailsQuestions.length === SOURCE_DETAILS_QUESTION_IDS.length;
  const hasBlobInputsStep = blobInputQuestions.length > 0;
  const hasFilesInputsStep = filesInputQuestions.length > 0;

  const firstDetailIndex = hasCommonStep
    ? Math.max(...commonQuestions.map((q) => questions.findIndex((item) => item.id === q.id))) + 1
    : 0;

  const blobInputStartIndex = hasBlobInputsStep
    ? Math.min(...blobInputQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;
  const blobInputEndIndex = hasBlobInputsStep
    ? Math.max(...blobInputQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;
  const sourceDetailsStartIndex = hasSourceDetailsStep
    ? Math.min(...sourceDetailsQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;
  const sourceDetailsEndIndex = hasSourceDetailsStep
    ? Math.max(...sourceDetailsQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;
  const filesInputStartIndex = hasFilesInputsStep
    ? Math.min(...filesInputQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;
  const filesInputEndIndex = hasFilesInputsStep
    ? Math.max(...filesInputQuestions.map((q) => questions.findIndex((item) => item.id === q.id)))
    : -1;

  const [currentIndex, setCurrentIndex] = useState(firstDetailIndex);
  const [isCommonStep, setIsCommonStep] = useState(hasCommonStep);
  const [isSourceDetailsStep, setIsSourceDetailsStep] = useState(false);
  const [isBlobInputsStep, setIsBlobInputsStep] = useState(false);
  const [isFilesInputsStep, setIsFilesInputsStep] = useState(false);
  const [answers, setAnswers] = useState({});
  const [commonValues, setCommonValues] = useState(COMMON_DEFAULTS);
  const [blobInputValues, setBlobInputValues] = useState(BLOB_INPUT_DEFAULTS);
  const [sourceDetailsValues, setSourceDetailsValues] = useState(SOURCE_DETAILS_DEFAULTS);
  const [filesInputValues, setFilesInputValues] = useState(FILES_INPUT_DEFAULTS);
  const [selectValue, setSelectValue] = useState("");
  const [multiValues, setMultiValues] = useState([]);
  const activeRef = useRef(null);

  const question = isCommonStep || isSourceDetailsStep || isBlobInputsStep || isFilesInputsStep
    ? null
    : questions[currentIndex];
  const isSelect = question?.type === "select";
  const isMulti = question?.type === "multiselect";

  function getCommonAnswersSnapshot(sourceAnswers) {
    const normalizedWorkload = normalizeWorkloadState(sourceAnswers);
    return {
      nas: sourceAnswers.nas ?? COMMON_DEFAULTS.nas,
      sourceProtocol: Array.isArray(sourceAnswers.sourceProtocol)
        ? sourceAnswers.sourceProtocol
        : COMMON_DEFAULTS.sourceProtocol,
      workloadType: normalizedWorkload.workloadType,
      workloadTypeSelections: normalizedWorkload.workloadTypeSelections,
      workloadDistribution: normalizedWorkload.workloadDistribution,
      sourceShareSizeTb: sourceAnswers.sourceShareSizeTb ?? COMMON_DEFAULTS.sourceShareSizeTb,
      sourceIops: sourceAnswers.sourceIops ?? COMMON_DEFAULTS.sourceIops,
      sourceThroughputMibps: sourceAnswers.sourceThroughputMibps ?? COMMON_DEFAULTS.sourceThroughputMibps,
      comfortFactor: sourceAnswers.comfortFactor ?? COMMON_DEFAULTS.comfortFactor,
      assessmentCriteria: sourceAnswers.assessmentCriteria ?? COMMON_DEFAULTS.assessmentCriteria,
    };
  }

  function getBlobInputsAnswersSnapshot(sourceAnswers) {
    return {
      blobWorkloadType: sourceAnswers.blobWorkloadType ?? BLOB_INPUT_DEFAULTS.blobWorkloadType,
      blobAccessFrequency: sourceAnswers.blobAccessFrequency ?? BLOB_INPUT_DEFAULTS.blobAccessFrequency,
    };
  }

  function getSourceDetailsAnswersSnapshot(sourceAnswers) {
    const filesMediaQuestion = sourceDetailsQuestions.find((q) => q.id === "filesMediaType");
    const defaultFilesMedia = filesMediaQuestion
      ? (getDefaultMultiValues(filesMediaQuestion).length > 0
          ? getDefaultMultiValues(filesMediaQuestion)
          : SOURCE_DETAILS_DEFAULTS.filesMediaType)
      : SOURCE_DETAILS_DEFAULTS.filesMediaType;

    return {
      region: sourceAnswers.region ?? SOURCE_DETAILS_DEFAULTS.region,
      redundancy: sourceAnswers.redundancy ?? SOURCE_DETAILS_DEFAULTS.redundancy,
      targetService: Array.isArray(sourceAnswers.targetService)
        ? sourceAnswers.targetService
        : SOURCE_DETAILS_DEFAULTS.targetService,
      blobAccessFrequency: sourceAnswers.blobAccessFrequency ?? SOURCE_DETAILS_DEFAULTS.blobAccessFrequency,
      filesMediaType: Array.isArray(sourceAnswers.filesMediaType)
        ? sourceAnswers.filesMediaType
        : (sourceAnswers.filesMediaType ? [sourceAnswers.filesMediaType] : defaultFilesMedia),
      maximizeReadinessAcrossTargets:
        sourceAnswers.maximizeReadinessAcrossTargets
        ?? SOURCE_DETAILS_DEFAULTS.maximizeReadinessAcrossTargets,
    };
  }

  function getFilesInputsAnswersSnapshot(sourceAnswers) {
    const filesMediaQuestion = filesInputQuestions.find((q) => q.id === "filesMediaType");
    const defaultFilesMedia = filesMediaQuestion
      ? (getDefaultMultiValues(filesMediaQuestion).length > 0
          ? getDefaultMultiValues(filesMediaQuestion)
          : FILES_INPUT_DEFAULTS.filesMediaType)
      : FILES_INPUT_DEFAULTS.filesMediaType;
    return {
      filesMediaType: Array.isArray(sourceAnswers.filesMediaType)
        ? sourceAnswers.filesMediaType
        : (sourceAnswers.filesMediaType ? [sourceAnswers.filesMediaType] : defaultFilesMedia),
    };
  }

  function isBlobInputQuestion(questionId) {
    return BLOB_INPUT_QUESTION_IDS.includes(questionId);
  }

  function isSourceDetailsQuestion(questionId) {
    return SOURCE_DETAILS_QUESTION_IDS.includes(questionId);
  }

  function isFilesInputQuestion(questionId) {
    return FILES_INPUT_QUESTION_IDS.includes(questionId);
  }

  function shouldShowSourceDetailsStep(sourceAnswers) {
    return hasSourceDetailsStep;
  }

  function shouldShowBlobInputsStep(sourceAnswers) {
    return false;
  }

  function shouldShowFilesInputsStep(sourceAnswers) {
    return false;
  }

  function getNextDetailIndex(startIndex, sourceAnswers) {
    let next = startIndex;
    while (next < questions.length) {
      const nextQuestion = questions[next];

      if (isBlobInputQuestion(nextQuestion.id)) {
        if (!shouldShowBlobInputsStep(sourceAnswers)) {
          delete sourceAnswers[nextQuestion.id];
        }
        next++;
        continue;
      }

      if (isSourceDetailsQuestion(nextQuestion.id)) {
        if (!shouldShowSourceDetailsStep(sourceAnswers)) {
          delete sourceAnswers[nextQuestion.id];
        }
        next++;
        continue;
      }

      if (isFilesInputQuestion(nextQuestion.id)) {
        if (!shouldShowFilesInputsStep(sourceAnswers)) {
          delete sourceAnswers[nextQuestion.id];
        }
        next++;
        continue;
      }

      if (!isQuestionVisible(nextQuestion, sourceAnswers)) {
        delete sourceAnswers[nextQuestion.id];
        next++;
        continue;
      }

      break;
    }

    return next;
  }

  function getPreviousDetailIndex(startIndex, sourceAnswers) {
    let prev = startIndex;
    while (prev >= firstDetailIndex) {
      const prevQuestion = questions[prev];
      if (
        isBlobInputQuestion(prevQuestion.id)
        || isSourceDetailsQuestion(prevQuestion.id)
        || isFilesInputQuestion(prevQuestion.id)
        || !isQuestionVisible(prevQuestion, sourceAnswers)
      ) {
        prev--;
        continue;
      }
      break;
    }

    return prev;
  }

  // Sync local UI state and scroll active card into view on question change
  useEffect(() => {
    if (!question) return;
    if (isSelect) {
      setSelectValue(answers[question.id] ?? getFirstValue(question));
    }
    if (isMulti) {
      setMultiValues(answers[question.id] ?? getDefaultMultiValues(question));
    }
    setTimeout(() => {
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, [currentIndex, isCommonStep, isSourceDetailsStep, isBlobInputsStep, isFilesInputsStep]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isCommonStep && !isSourceDetailsStep && !isBlobInputsStep && !isFilesInputsStep) return;
    setTimeout(() => {
      activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }, [isCommonStep, isSourceDetailsStep, isBlobInputsStep, isFilesInputsStep]);

  function advance(value) {
    if (!question) return;

    const prev = answers[question.id];
    let updated = { ...answers, [question.id]: value };

    const prevStr = JSON.stringify(prev);
    const nextStr = JSON.stringify(value);
    if (prev !== undefined && prevStr !== nextStr) {
      questions.slice(currentIndex + 1).forEach((q) => delete updated[q.id]);
    }

    const next = getNextDetailIndex(currentIndex + 1, updated);

    setAnswers(updated);
    if (next < questions.length) {
      setCurrentIndex(next);
    } else {
      onComplete(updated);
    }
  }

  function handleCommonNasChange(value) {
    setCommonValues((prev) => ({
      ...prev,
      nas: value,
    }));

    if (value !== "netapp") {
      setSourceDetailsValues((prev) => ({
        ...prev,
        targetService: Array.isArray(prev.targetService)
          ? prev.targetService.filter((service) => service !== "anf")
          : prev.targetService,
      }));
    }
  }

  function toggleTargetService(value) {
    setSourceDetailsValues((prev) => ({
      ...prev,
      targetService: prev.targetService.includes(value)
        ? prev.targetService.filter((service) => service !== value)
        : [...prev.targetService, value],
    }));
  }

  function handleCommonContinue() {
    const workloadTotal = getWorkloadTotal(commonValues.workloadDistribution);
    if (workloadTotal !== 100) {
      window.alert("Please increase or decrease the workload percentages so the first 5 workloads total 100%.");
      return;
    }

    const selectedPrimaryWorkloads = PRIMARY_WORKLOAD_VALUES.filter(
      (value) => Number(commonValues.workloadDistribution?.[value]) > 0
    );

    if (selectedPrimaryWorkloads.length === 0) {
      window.alert("Please select at least one workload and assign percentages that total 100%.");
      return;
    }

    const derivedWorkloadType = getDerivedWorkloadType(
      commonValues.workloadTypeSelections,
      commonValues.workloadDistribution
    );
    const normalizedCommonValues = {
      ...commonValues,
      workloadType: derivedWorkloadType,
      workloadTypeSelections: [
        ...new Set([
          ...selectedPrimaryWorkloads,
          ...(Array.isArray(commonValues.workloadTypeSelections)
            && commonValues.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)
            ? [MIXED_WORKLOAD_VALUE]
            : []),
        ]),
      ],
    };

    const prevCommon = getCommonAnswersSnapshot(answers);
    const commonChanged = JSON.stringify(prevCommon) !== JSON.stringify(normalizedCommonValues);

    let updated = {
      ...answers,
      ...normalizedCommonValues,
    };

    if (commonChanged) {
      questions.slice(firstDetailIndex).forEach((q) => delete updated[q.id]);
    }

    setAnswers(updated);

    if (shouldShowSourceDetailsStep(updated)) {
      setSourceDetailsValues(getSourceDetailsAnswersSnapshot(updated));
      setIsCommonStep(false);
      setIsSourceDetailsStep(true);
      setIsBlobInputsStep(false);
      setIsFilesInputsStep(false);
      return;
    }

    if (shouldShowBlobInputsStep(updated)) {
      setBlobInputValues(getBlobInputsAnswersSnapshot(updated));
      setIsCommonStep(false);
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(true);
      setIsFilesInputsStep(false);
      return;
    }

    if (shouldShowFilesInputsStep(updated)) {
      setFilesInputValues(getFilesInputsAnswersSnapshot(updated));
      setIsCommonStep(false);
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(false);
      setIsFilesInputsStep(true);
      return;
    }

    const next = getNextDetailIndex(firstDetailIndex, updated);

    if (next < questions.length) {
      setCurrentIndex(next);
      setIsCommonStep(false);
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(false);
      setIsFilesInputsStep(false);
    } else {
      onComplete(updated);
    }
  }

  function handleSourceDetailsContinue() {
    const prevSourceDetails = getSourceDetailsAnswersSnapshot(answers);
    const sourceDetailsChanged = JSON.stringify(prevSourceDetails) !== JSON.stringify(sourceDetailsValues);

    let updated = {
      ...answers,
      ...sourceDetailsValues,
    };

    if (sourceDetailsChanged) {
      questions.slice(sourceDetailsEndIndex + 1).forEach((q) => delete updated[q.id]);
    }

    setAnswers(updated);

    if (shouldShowBlobInputsStep(updated)) {
      setBlobInputValues(getBlobInputsAnswersSnapshot(updated));
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(true);
      setIsFilesInputsStep(false);
      return;
    }

    if (shouldShowFilesInputsStep(updated)) {
      setFilesInputValues(getFilesInputsAnswersSnapshot(updated));
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(false);
      setIsFilesInputsStep(true);
      return;
    }

    const next = getNextDetailIndex(sourceDetailsEndIndex + 1, updated);

    setIsSourceDetailsStep(false);
    setIsBlobInputsStep(false);
    setIsFilesInputsStep(false);

    if (next < questions.length) {
      setCurrentIndex(next);
    } else {
      onComplete(updated);
    }
  }

  function handleBlobInputsContinue() {
    const prevBlobInputs = getBlobInputsAnswersSnapshot(answers);
    const blobInputsChanged = JSON.stringify(prevBlobInputs) !== JSON.stringify(blobInputValues);

    let updated = {
      ...answers,
      ...blobInputValues,
    };

    if (blobInputsChanged) {
      questions.slice(blobInputEndIndex + 1).forEach((q) => delete updated[q.id]);
    }

    setAnswers(updated);

    if (shouldShowFilesInputsStep(updated)) {
      setFilesInputValues(getFilesInputsAnswersSnapshot(updated));
      setIsSourceDetailsStep(false);
      setIsBlobInputsStep(false);
      setIsFilesInputsStep(true);
      return;
    }

    const next = getNextDetailIndex(blobInputEndIndex + 1, updated);

    setIsSourceDetailsStep(false);
    setIsBlobInputsStep(false);
    setIsFilesInputsStep(false);

    if (next < questions.length) {
      setCurrentIndex(next);
    } else {
      onComplete(updated);
    }
  }

  function handleFilesInputsContinue() {
    const prevFilesInputs = getFilesInputsAnswersSnapshot(answers);
    const filesInputsChanged = JSON.stringify(prevFilesInputs) !== JSON.stringify(filesInputValues);

    let updated = {
      ...answers,
      ...filesInputValues,
    };

    if (filesInputsChanged) {
      questions.slice(filesInputEndIndex + 1).forEach((q) => delete updated[q.id]);
    }

    const next = getNextDetailIndex(filesInputEndIndex + 1, updated);

    setAnswers(updated);
    setIsSourceDetailsStep(false);
    setIsFilesInputsStep(false);

    if (next < questions.length) {
      setCurrentIndex(next);
    } else {
      onComplete(updated);
    }
  }

  function handleBack() {
    if (isCommonStep) return;

    if (isSourceDetailsStep) {
      if (hasCommonStep) {
        setCommonValues(getCommonAnswersSnapshot(answers));
        setIsSourceDetailsStep(false);
        setIsCommonStep(true);
      }
      return;
    }

    if (isBlobInputsStep) {
      if (shouldShowSourceDetailsStep(answers)) {
        setSourceDetailsValues(getSourceDetailsAnswersSnapshot(answers));
        setIsBlobInputsStep(false);
        setIsSourceDetailsStep(true);
        return;
      }

      if (hasCommonStep) {
        setCommonValues(getCommonAnswersSnapshot(answers));
        setIsBlobInputsStep(false);
        setIsCommonStep(true);
      }
      return;
    }

    if (isFilesInputsStep) {
      if (shouldShowBlobInputsStep(answers)) {
        setBlobInputValues(getBlobInputsAnswersSnapshot(answers));
        setIsFilesInputsStep(false);
        setIsBlobInputsStep(true);
        return;
      }

      if (shouldShowSourceDetailsStep(answers)) {
        setSourceDetailsValues(getSourceDetailsAnswersSnapshot(answers));
        setIsFilesInputsStep(false);
        setIsSourceDetailsStep(true);
        return;
      }

      if (hasCommonStep) {
        setCommonValues(getCommonAnswersSnapshot(answers));
        setIsFilesInputsStep(false);
        setIsCommonStep(true);
      }
      return;
    }

    const prev = getPreviousDetailIndex(currentIndex - 1, answers);

    if (
      shouldShowFilesInputsStep(answers)
      && currentIndex > filesInputEndIndex
      && prev < firstDetailIndex
    ) {
      setFilesInputValues(getFilesInputsAnswersSnapshot(answers));
      setIsFilesInputsStep(true);
      return;
    }

    if (
      shouldShowBlobInputsStep(answers)
      && currentIndex > blobInputEndIndex
      && prev < firstDetailIndex
    ) {
      setBlobInputValues(getBlobInputsAnswersSnapshot(answers));
      setIsBlobInputsStep(true);
      return;
    }

    if (
      shouldShowSourceDetailsStep(answers)
      && currentIndex > sourceDetailsEndIndex
      && prev < firstDetailIndex
    ) {
      setSourceDetailsValues(getSourceDetailsAnswersSnapshot(answers));
      setIsSourceDetailsStep(true);
      return;
    }

    if (prev < firstDetailIndex && hasCommonStep) {
      setCommonValues(getCommonAnswersSnapshot(answers));
      setIsCommonStep(true);
      return;
    }

    setCurrentIndex(prev < firstDetailIndex ? firstDetailIndex : prev);
  }

  function toggleMulti(value) {
    setMultiValues((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  // All answered visible questions that come before the active one
  const answeredIndices = [];
  if (!isCommonStep && !isSourceDetailsStep && !isBlobInputsStep && !isFilesInputsStep) {
    for (let i = firstDetailIndex; i < currentIndex; i++) {
      if (isSourceDetailsQuestion(questions[i].id)) {
        continue;
      }
      if (isBlobInputQuestion(questions[i].id)) {
        continue;
      }
      if (isFilesInputQuestion(questions[i].id)) {
        continue;
      }
      if (answers[questions[i].id] !== undefined) {
        answeredIndices.push(i);
      }
    }
  }

  const visibleOptions = question && (isMulti || isSelect)
    ? getVisibleOptions(question.options, answers)
    : question?.options;

  const nasQuestion = commonQuestions.find((q) => q.id === "nas");
  const sourceProtocolQuestion = commonQuestions.find((q) => q.id === "sourceProtocol");
  const sourceWorkloadTypeQuestion = commonQuestions.find((q) => q.id === "workloadType");
  const sourceShareSizeQuestion = commonQuestions.find((q) => q.id === "sourceShareSizeTb");
  const sourceIopsQuestion = commonQuestions.find((q) => q.id === "sourceIops");
  const sourceThroughputQuestion = commonQuestions.find((q) => q.id === "sourceThroughputMibps");
  const comfortFactorQuestion = commonQuestions.find((q) => q.id === "comfortFactor");
  const assessmentCriteriaQuestion = commonQuestions.find((q) => q.id === "assessmentCriteria");
  const regionQuestion = sourceDetailsQuestions.find((q) => q.id === "region");
  const redundancyQuestion = sourceDetailsQuestions.find((q) => q.id === "redundancy");
  const targetServiceQuestion = sourceDetailsQuestions.find((q) => q.id === "targetService");
  const blobAccessFrequencyQuestion = sourceDetailsQuestions.find((q) => q.id === "blobAccessFrequency");
  const filesMediaTypeQuestion = sourceDetailsQuestions.find((q) => q.id === "filesMediaType");

  const visibleSourceProtocolOptions = sourceProtocolQuestion
    ? getVisibleOptions(sourceProtocolQuestion.options, {
        ...answers,
        ...commonValues,
      })
    : [];

  const visibleSourceWorkloadTypeOptions = sourceWorkloadTypeQuestion
    ? getVisibleOptions(sourceWorkloadTypeQuestion.options, {
        ...answers,
        ...commonValues,
      })
    : [];

  const visibleComfortFactorOptions = comfortFactorQuestion
    ? getVisibleOptions(comfortFactorQuestion.options, {
        ...answers,
        ...commonValues,
      })
    : [];

  const visibleAssessmentCriteriaOptions = assessmentCriteriaQuestion
    ? getVisibleOptions(assessmentCriteriaQuestion.options, {
        ...answers,
        ...commonValues,
      })
    : [];

  const visibleCommonServiceOptions = targetServiceQuestion
    ? getVisibleOptions(targetServiceQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleBlobFrequencyOptions = blobAccessFrequencyQuestion
    ? getVisibleOptions(blobAccessFrequencyQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleFilesMediaOptions = filesMediaTypeQuestion
    ? getVisibleOptions(filesMediaTypeQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const isCommonValid =
    commonValues.nas &&
    Array.isArray(commonValues.sourceProtocol) &&
    commonValues.sourceProtocol.length > 0 &&
    getWorkloadTotal(commonValues.workloadDistribution) === 100 &&
    PRIMARY_WORKLOAD_VALUES.some((value) => Number(commonValues.workloadDistribution?.[value] ?? 0) > 0) &&
    isPositiveNumber(commonValues.sourceShareSizeTb) &&
    isPositiveNumber(commonValues.sourceIops) &&
    isPositiveNumber(commonValues.sourceThroughputMibps) &&
    commonValues.comfortFactor &&
    commonValues.assessmentCriteria;

  const isSourceDetailsValid =
    sourceDetailsValues.region &&
    sourceDetailsValues.redundancy &&
    Array.isArray(sourceDetailsValues.targetService) &&
    sourceDetailsValues.targetService.length > 0 &&
    (!sourceDetailsValues.targetService.includes("blobs") || sourceDetailsValues.blobAccessFrequency);

  const isBlobInputsValid =
    blobInputValues.blobAccessFrequency;

  const isFilesInputsValid =
    Array.isArray(filesInputValues.filesMediaType)
    && filesInputValues.filesMediaType.length > 0;

  const commonAnswered =
    answers.nas !== undefined &&
    answers.sourceProtocol !== undefined &&
    answers.workloadType !== undefined &&
    answers.sourceShareSizeTb !== undefined &&
    answers.sourceIops !== undefined &&
    answers.sourceThroughputMibps !== undefined &&
    answers.comfortFactor !== undefined &&
    answers.assessmentCriteria !== undefined;

  const sourceDetailsAnswered =
    answers.region !== undefined &&
    answers.redundancy !== undefined &&
    answers.targetService !== undefined;

  const blobInputsAnswered =
    answers.blobAccessFrequency !== undefined;

  const filesInputsAnswered =
    answers.filesMediaType !== undefined;

  const commonSummaryLabel = [
    nasQuestion ? resolveLabel(nasQuestion, answers.nas) : "",
    sourceProtocolQuestion ? resolveLabel(sourceProtocolQuestion, answers.sourceProtocol) : "",
    sourceWorkloadTypeQuestion ? formatWorkloadSummary(answers.workloadTypeSelections, answers.workloadDistribution) : "",
    sourceShareSizeQuestion && answers.sourceShareSizeTb !== undefined ? `${answers.sourceShareSizeTb} GB` : "",
    sourceIopsQuestion && answers.sourceIops !== undefined ? `${answers.sourceIops} IOPS` : "",
    sourceThroughputQuestion && answers.sourceThroughputMibps !== undefined ? `${answers.sourceThroughputMibps} MiB/s` : "",
    comfortFactorQuestion ? resolveLabel(comfortFactorQuestion, answers.comfortFactor) : "",
    assessmentCriteriaQuestion ? resolveLabel(assessmentCriteriaQuestion, answers.assessmentCriteria) : "",
  ].filter(Boolean).join(" | ");

  const sourceDetailsSummaryLabel = [
    regionQuestion ? resolveLabel(regionQuestion, answers.region) : "",
    redundancyQuestion ? resolveLabel(redundancyQuestion, answers.redundancy) : "",
    targetServiceQuestion ? resolveLabel(targetServiceQuestion, answers.targetService) : "",
    blobAccessFrequencyQuestion ? resolveLabel(blobAccessFrequencyQuestion, answers.blobAccessFrequency) : "",
    answers.maximizeReadinessAcrossTargets ? "Maximise readiness enabled" : "Maximise readiness disabled",
  ].filter(Boolean).join(" | ");

  const blobInputsSummaryLabel = [
    blobAccessFrequencyQuestion ? resolveLabel(blobAccessFrequencyQuestion, answers.blobAccessFrequency) : "",
  ].filter(Boolean).join(" | ");

  const filesInputsSummaryLabel = [
    filesMediaTypeQuestion ? resolveLabel(filesMediaTypeQuestion, answers.filesMediaType) : "",
  ].filter(Boolean).join(" | ");

  const showSourceDetailsStep = shouldShowSourceDetailsStep(answers);
  const showBlobInputsStep = shouldShowBlobInputsStep(answers);
  const showFilesInputsStep = shouldShowFilesInputsStep(answers);
  const workloadTotal = getWorkloadTotal(commonValues.workloadDistribution);

  // Step number includes grouped Common, Source, Blob, and Files cards when they are part of the flow.
  const stepNumber = isCommonStep
    ? 1
    : isSourceDetailsStep
      ? (hasCommonStep ? 2 : 1)
    : isBlobInputsStep
      ? (hasCommonStep ? 2 : 1) + (showSourceDetailsStep ? 1 : 0)
      : isFilesInputsStep
        ? (hasCommonStep ? 2 : 1) + (showSourceDetailsStep ? 1 : 0) + (showBlobInputsStep ? 1 : 0)
      : answeredIndices.length
        + 1
        + (hasCommonStep ? 1 : 0)
        + (showSourceDetailsStep ? 1 : 0)
        + (showBlobInputsStep ? 1 : 0)
        + (showFilesInputsStep ? 1 : 0);

  return (
    <div className="questions-container">
      {/* Compact answered cards */}
      {!isCommonStep && commonAnswered && (
        <div className="answered-card common-answered-card">
          <span className="answered-label">Source details (one share at a time)</span>
          <span className="answered-value">{commonSummaryLabel}</span>
        </div>
      )}

      {!isCommonStep && !isSourceDetailsStep && showSourceDetailsStep && sourceDetailsAnswered && (
        <div className="answered-card source-details-answered-card">
          <span className="answered-label">Target details</span>
          <span className="answered-value">{sourceDetailsSummaryLabel}</span>
        </div>
      )}

      {!isCommonStep && !isSourceDetailsStep && !isBlobInputsStep && showBlobInputsStep && blobInputsAnswered && (
        <div className="answered-card blob-inputs-answered-card">
          <span className="answered-label">Inputs for Azure Blob</span>
          <span className="answered-value">{blobInputsSummaryLabel}</span>
        </div>
      )}

      {!isCommonStep && !isSourceDetailsStep && !isBlobInputsStep && !isFilesInputsStep && showFilesInputsStep && filesInputsAnswered && (
        <div className="answered-card files-inputs-answered-card">
          <span className="answered-label">Inputs for Azure Files</span>
          <span className="answered-value">{filesInputsSummaryLabel}</span>
        </div>
      )}

      {answeredIndices.map((idx) => {
        const q = questions[idx];
        return (
          <div key={q.id} className="answered-card">
            <span className="answered-label">{q.text}</span>
            <span className="answered-value">{resolveLabel(q, answers[q.id])}</span>
          </div>
        );
      })}

      {/* Active step card */}
      {isCommonStep ? (
        <div className="card common-card" ref={activeRef}>
          <p className="step-label">Step 1</p>
          <h2 className="question-text">Source details (one share at a time)</h2>
          <p className="question-note">Provide source-share details first so we can evaluate target options consistently.</p>

          <div className="common-grid">
            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="common-nas">{nasQuestion?.text}</label>
              <select
                id="common-nas"
                className="select-input"
                value={commonValues.nas}
                onChange={(e) => handleCommonNasChange(e.target.value)}
              >
                {nasQuestion?.placeholder && (
                  <option value="" disabled>{nasQuestion.placeholder}</option>
                )}
                {nasQuestion?.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="common-field common-field--full">
              <p className="common-field-label">{sourceProtocolQuestion?.text}</p>
              <p className="multiselect-hint">Select all that apply</p>
              <div className="checkbox-list common-checkbox-list">
                {visibleSourceProtocolOptions.map((opt) => (
                  <label key={opt.value} className={`checkbox-label${commonValues.sourceProtocol.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={commonValues.sourceProtocol.includes(opt.value)}
                      onChange={() => setCommonValues((prev) => ({
                        ...prev,
                        sourceProtocol: prev.sourceProtocol.includes(opt.value)
                          ? prev.sourceProtocol.filter((value) => value !== opt.value)
                          : [...prev.sourceProtocol, opt.value],
                      }))}
                    />
                    <span className="checkbox-text">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="source-workload-type">
                {sourceWorkloadTypeQuestion?.text}
                {sourceWorkloadTypeQuestion?.tooltip && (
                  <span
                    className="question-tooltip"
                    title={sourceWorkloadTypeQuestion.tooltip}
                    aria-label={sourceWorkloadTypeQuestion.tooltip}
                  >
                    i
                  </span>
                )}
              </label>
              <p className="multiselect-hint">Select one or more of the first 5 workloads and set each slider in 10% increments so total = 100%.</p>

              <div id="source-workload-type" className="workload-slider-list">
                {visibleSourceWorkloadTypeOptions
                  .filter((opt) => opt.value !== MIXED_WORKLOAD_VALUE)
                  .map((opt) => {
                    const sliderValue = Number(commonValues.workloadDistribution?.[opt.value] ?? 0);
                    const isChecked = sliderValue > 0 || commonValues.workloadTypeSelections.includes(opt.value);
                    return (
                      <div key={opt.value} className="workload-slider-item">
                        <label className={`checkbox-label${isChecked ? " checked" : ""}`}>
                          <input
                            type="checkbox"
                            className="checkbox-input"
                            checked={isChecked}
                            onChange={() => {
                              setCommonValues((prev) => {
                                const currentlyChecked = Number(prev.workloadDistribution?.[opt.value] ?? 0) > 0
                                  || prev.workloadTypeSelections.includes(opt.value);
                                const nextDistribution = {
                                  ...prev.workloadDistribution,
                                  [opt.value]: currentlyChecked ? 0 : 10,
                                };
                                const selected = PRIMARY_WORKLOAD_VALUES.filter(
                                  (value) => Number(nextDistribution[value]) > 0
                                );
                                const keepMixed = prev.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)
                                  && isMixedPresetDistribution(nextDistribution)
                                  ? [MIXED_WORKLOAD_VALUE]
                                  : [];
                                return {
                                  ...prev,
                                  workloadDistribution: nextDistribution,
                                  workloadTypeSelections: [...selected, ...keepMixed],
                                };
                              });
                            }}
                          />
                          <span className="checkbox-text">{opt.label}</span>
                        </label>

                        <div className="workload-slider-control">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            step="10"
                            value={sliderValue}
                            onChange={(e) => {
                              const nextValue = Number(e.target.value);
                              setCommonValues((prev) => {
                                const nextDistribution = {
                                  ...prev.workloadDistribution,
                                  [opt.value]: nextValue,
                                };
                                const selected = PRIMARY_WORKLOAD_VALUES.filter(
                                  (value) => Number(nextDistribution[value]) > 0
                                );
                                const keepMixed = prev.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)
                                  && isMixedPresetDistribution(nextDistribution)
                                  ? [MIXED_WORKLOAD_VALUE]
                                  : [];
                                return {
                                  ...prev,
                                  workloadDistribution: nextDistribution,
                                  workloadTypeSelections: [...selected, ...keepMixed],
                                };
                              });
                            }}
                          />
                          <span className="workload-slider-value">{sliderValue}%</span>
                        </div>
                      </div>
                    );
                  })}

                {visibleSourceWorkloadTypeOptions
                  .filter((opt) => opt.value === MIXED_WORKLOAD_VALUE)
                  .map((opt) => {
                    const isMixedSelected = commonValues.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE);
                    return (
                      <label key={opt.value} className={`checkbox-label${isMixedSelected ? " checked" : ""}`}>
                        <input
                          type="checkbox"
                          className="checkbox-input"
                          checked={isMixedSelected}
                          onChange={() => {
                            setCommonValues((prev) => {
                              if (prev.workloadTypeSelections.includes(MIXED_WORKLOAD_VALUE)) {
                                return {
                                  ...prev,
                                  workloadTypeSelections: prev.workloadTypeSelections.filter((value) => value !== MIXED_WORKLOAD_VALUE),
                                };
                              }

                              const presetDistribution = {
                                ...prev.workloadDistribution,
                              };
                              PRIMARY_WORKLOAD_VALUES.forEach((value, index) => {
                                presetDistribution[value] = MIXED_WORKLOAD_PRESET[index];
                              });

                              return {
                                ...prev,
                                workloadDistribution: presetDistribution,
                                workloadTypeSelections: [...PRIMARY_WORKLOAD_VALUES, MIXED_WORKLOAD_VALUE],
                              };
                            });
                          }}
                        />
                        <span className="checkbox-text">{opt.label}</span>
                      </label>
                    );
                  })}
              </div>

              <p className={`question-note${workloadTotal === 100 ? "" : " region-notice"}`}>
                Workload split total (first 5 options): {workloadTotal}%. Target is 100%.
              </p>
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="source-size-tb">{sourceShareSizeQuestion?.text}</label>
              <input
                id="source-size-tb"
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                placeholder={sourceShareSizeQuestion?.placeholder ?? "Enter value"}
                value={commonValues.sourceShareSizeTb}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, sourceShareSizeTb: e.target.value }))}
              />
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="source-iops">{sourceIopsQuestion?.text}</label>
              <input
                id="source-iops"
                className="text-input"
                type="number"
                min="0"
                step="1"
                placeholder={sourceIopsQuestion?.placeholder ?? "Enter value"}
                value={commonValues.sourceIops}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, sourceIops: e.target.value }))}
              />
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="source-throughput">{sourceThroughputQuestion?.text}</label>
              <input
                id="source-throughput"
                className="text-input"
                type="number"
                min="0"
                step="0.01"
                placeholder={sourceThroughputQuestion?.placeholder ?? "Enter value"}
                value={commonValues.sourceThroughputMibps}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, sourceThroughputMibps: e.target.value }))}
              />
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="comfort-factor">{comfortFactorQuestion?.text}</label>
              <select
                id="comfort-factor"
                className="select-input"
                value={commonValues.comfortFactor}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, comfortFactor: e.target.value }))}
              >
                {visibleComfortFactorOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="assessment-criteria">{assessmentCriteriaQuestion?.text}</label>
              <select
                id="assessment-criteria"
                className="select-input"
                value={commonValues.assessmentCriteria}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, assessmentCriteria: e.target.value }))}
              >
                {assessmentCriteriaQuestion?.placeholder && (
                  <option value="" disabled>{assessmentCriteriaQuestion.placeholder}</option>
                )}
                {visibleAssessmentCriteriaOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="continue-btn"
            disabled={!isCommonValid}
            onClick={handleCommonContinue}
          >
            Continue →
          </button>

        </div>
      ) : isSourceDetailsStep ? (
        <div className="card source-details-card" ref={activeRef}>
          <p className="step-label">Step {stepNumber}</p>
          <h2 className="question-text">Target details</h2>
          <p className="question-note">Provide target settings in one step. Azure Files assesses both Premium SSD and Standard HDD by default.</p>

          <div className="common-grid source-details-grid">
            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="target-region">{regionQuestion?.text}</label>
              <select
                id="target-region"
                className="select-input"
                value={sourceDetailsValues.region}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, region: e.target.value }))}
              >
                {regionQuestion?.placeholder && (
                  <option value="" disabled>{regionQuestion.placeholder}</option>
                )}
                {regionQuestion && isGrouped(regionQuestion)
                  ? regionQuestion.options.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.items.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : null}
              </select>
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="target-redundancy">{redundancyQuestion?.text}</label>
              <select
                id="target-redundancy"
                className="select-input"
                value={sourceDetailsValues.redundancy}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, redundancy: e.target.value }))}
              >
                {redundancyQuestion?.placeholder && (
                  <option value="" disabled>{redundancyQuestion.placeholder}</option>
                )}
                {redundancyQuestion?.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="common-field common-field--full">
              <p className="common-field-label">{targetServiceQuestion?.text}</p>
              <p className="multiselect-hint">Select all that apply</p>
              <div className="checkbox-list common-checkbox-list">
                {visibleCommonServiceOptions.map((opt) => (
                  <label key={opt.value} className={`checkbox-label${sourceDetailsValues.targetService.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={sourceDetailsValues.targetService.includes(opt.value)}
                      onChange={() => toggleTargetService(opt.value)}
                    />
                    <span className="checkbox-text">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {sourceDetailsValues.targetService.includes("blobs") && (
              <div className="common-field common-field--full">
                <label className="common-field-label" htmlFor="blob-access-frequency">{blobAccessFrequencyQuestion?.text}</label>
                <select
                  id="blob-access-frequency"
                  className="select-input"
                  value={sourceDetailsValues.blobAccessFrequency}
                  onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, blobAccessFrequency: e.target.value }))}
                >
                  {blobAccessFrequencyQuestion?.placeholder && (
                    <option value="" disabled>{blobAccessFrequencyQuestion.placeholder}</option>
                  )}
                  {visibleBlobFrequencyOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="common-field common-field--full">
              <label className={`checkbox-label${sourceDetailsValues.maximizeReadinessAcrossTargets ? " checked" : ""}`}>
                <input
                  type="checkbox"
                  className="checkbox-input"
                  checked={sourceDetailsValues.maximizeReadinessAcrossTargets}
                  onChange={(e) => setSourceDetailsValues((prev) => ({
                    ...prev,
                    maximizeReadinessAcrossTargets: e.target.checked,
                  }))}
                />
                <span className="checkbox-text">Maximise readiness across target services</span>
              </label>
              <p className="question-note">
                When enabled, an additional alternative target option is shown as Ready with Condition with protocol/application adaptation guidance.
              </p>
            </div>
          </div>

          <button
            className="continue-btn"
            disabled={!isSourceDetailsValid}
            onClick={handleSourceDetailsContinue}
          >
            Continue →
          </button>

          <button className="back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
      ) : isBlobInputsStep ? (
        <div className="card blob-inputs-card" ref={activeRef}>
          <p className="step-label">Step {stepNumber}</p>
          <h2 className="question-text">Inputs for Azure Blob</h2>
          <p className="question-note">Provide Blob-specific details used to match object storage recommendations.</p>

          <div className="common-grid blob-inputs-grid">
            <div className="common-field">
              <label className="common-field-label" htmlFor="blob-access-frequency">{blobAccessFrequencyQuestion?.text}</label>
              <select
                id="blob-access-frequency"
                className="select-input"
                value={blobInputValues.blobAccessFrequency}
                onChange={(e) => setBlobInputValues((prev) => ({ ...prev, blobAccessFrequency: e.target.value }))}
              >
                {blobAccessFrequencyQuestion?.placeholder && (
                  <option value="" disabled>{blobAccessFrequencyQuestion.placeholder}</option>
                )}
                {visibleBlobFrequencyOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            className="continue-btn"
            disabled={!isBlobInputsValid}
            onClick={handleBlobInputsContinue}
          >
            Continue →
          </button>

          <button className="back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
      ) : isFilesInputsStep ? (
        <div className="card files-inputs-card" ref={activeRef}>
          <p className="step-label">Step {stepNumber}</p>
          <h2 className="question-text">Inputs for Azure Files</h2>
          <p className="question-note">Provide Azure Files-specific details used to match file storage recommendations.</p>

          <div className="common-grid files-inputs-grid">
            <div className="common-field common-field--full">
              <p className="common-field-label">{filesMediaTypeQuestion?.text}</p>
              <p className="multiselect-hint">Select all that apply</p>
              <div className="checkbox-list common-checkbox-list">
                {visibleFilesMediaOptions.map((opt) => (
                  <label key={opt.value} className={`checkbox-label${filesInputValues.filesMediaType.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={filesInputValues.filesMediaType.includes(opt.value)}
                      onChange={() => setFilesInputValues((prev) => ({
                        ...prev,
                        filesMediaType: prev.filesMediaType.includes(opt.value)
                          ? prev.filesMediaType.filter((value) => value !== opt.value)
                          : [...prev.filesMediaType, opt.value],
                      }))}
                    />
                    <span className="checkbox-text">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <button
            className="continue-btn"
            disabled={!isFilesInputsValid}
            onClick={handleFilesInputsContinue}
          >
            Continue →
          </button>

          <button className="back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
      ) : (
        <div className="card" ref={activeRef}>
          <p className="step-label">Step {stepNumber}</p>
          <h2 className="question-text">
            {question.text}
            {question.tooltip && (
              <span
                className="question-tooltip"
                title={question.tooltip}
                aria-label={question.tooltip}
              >
                i
              </span>
            )}
          </h2>
          {question.note && (
            <p className="question-note">{question.note}</p>
          )}

          {isSelect ? (
            <div className="select-wrapper">
              <select
                className="select-input"
                value={selectValue}
                onChange={(e) => setSelectValue(e.target.value)}
              >
                {question.placeholder && (
                  <option value="" disabled>{question.placeholder}</option>
                )}
                {isGrouped(question)
                  ? question.options.map((group) => (
                      <optgroup key={group.group} label={group.group}>
                        {group.items.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : visibleOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                }
              </select>
              <button
                className="continue-btn"
                disabled={!selectValue}
                onClick={() => advance(selectValue)}
              >
                Continue →
              </button>
            </div>
          ) : isMulti ? (
            <div className="multiselect-wrapper">
              <p className="multiselect-hint">Select all that apply</p>
              <div className="checkbox-list">
                {visibleOptions.map((opt) => (
                  <label key={opt.value} className={`checkbox-label${multiValues.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={multiValues.includes(opt.value)}
                      onChange={() => toggleMulti(opt.value)}
                    />
                    <span className="checkbox-text">{opt.label}</span>
                  </label>
                ))}
              </div>
              <button
                className="continue-btn"
                disabled={multiValues.length === 0}
                onClick={() => advance(multiValues)}
              >
                Continue →
              </button>
            </div>
          ) : (
            <div className="options-list">
              {visibleOptions.map((opt) => (
                <button
                  key={opt.value}
                  className={`option-btn ${answers[question.id] === opt.value ? "selected" : ""}`}
                  onClick={() => advance(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          <button className="back-btn" onClick={handleBack}>
            ← Back
          </button>
        </div>
      )}
    </div>
  );
}
