import { useState, useEffect, useRef } from "react";

const COMMON_QUESTION_IDS = ["region", "nas", "targetService", "redundancy"];
const SOURCE_DETAILS_QUESTION_IDS = [
  "sourceProtocol",
  "workloadType",
  "sourceShareSizeTb",
  "sourceIops",
  "sourceThroughputMibps",
  "comfortFactor",
  "assessmentCriteria",
];
const BLOB_INPUT_QUESTION_IDS = ["blobWorkloadType", "blobAccessFrequency"];
const FILES_INPUT_QUESTION_IDS = ["filesMediaType"];

const COMMON_DEFAULTS = {
  region: "eastus",
  nas: "netapp",
  targetService: ["files"],
  redundancy: "lrs",
};

const SOURCE_DETAILS_DEFAULTS = {
  sourceProtocol: ["smb_v3"],
  workloadType: "General-purpose file shares / team shares (incl. user data shares)",
  sourceShareSizeTb: "1024",
  sourceIops: "1000",
  sourceThroughputMibps: "100",
  comfortFactor: "1.0",
  assessmentCriteria: "perf_based",
};

const BLOB_INPUT_DEFAULTS = {
  blobWorkloadType: "appdata",
  blobAccessFrequency: "hot",
};

const FILES_INPUT_DEFAULTS = {
  filesMediaType: ["ssd"],
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
  const hasBlobInputsStep = blobInputQuestions.length === BLOB_INPUT_QUESTION_IDS.length;
  const hasFilesInputsStep = filesInputQuestions.length === FILES_INPUT_QUESTION_IDS.length;

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
    return {
      region: sourceAnswers.region ?? COMMON_DEFAULTS.region,
      nas: sourceAnswers.nas ?? COMMON_DEFAULTS.nas,
      targetService: Array.isArray(sourceAnswers.targetService)
        ? sourceAnswers.targetService
        : COMMON_DEFAULTS.targetService,
      redundancy: sourceAnswers.redundancy ?? COMMON_DEFAULTS.redundancy,
    };
  }

  function getBlobInputsAnswersSnapshot(sourceAnswers) {
    return {
      blobWorkloadType: sourceAnswers.blobWorkloadType ?? BLOB_INPUT_DEFAULTS.blobWorkloadType,
      blobAccessFrequency: sourceAnswers.blobAccessFrequency ?? BLOB_INPUT_DEFAULTS.blobAccessFrequency,
    };
  }

  function getSourceDetailsAnswersSnapshot(sourceAnswers) {
    const comfortFactorQuestion = sourceDetailsQuestions.find((q) => q.id === "comfortFactor");
    const sourceProtocolQuestion = sourceDetailsQuestions.find((q) => q.id === "sourceProtocol");
    const defaultSourceProtocols = sourceProtocolQuestion
      ? (getDefaultMultiValues(sourceProtocolQuestion).length > 0
          ? getDefaultMultiValues(sourceProtocolQuestion)
          : SOURCE_DETAILS_DEFAULTS.sourceProtocol)
      : SOURCE_DETAILS_DEFAULTS.sourceProtocol;

    return {
      sourceProtocol: Array.isArray(sourceAnswers.sourceProtocol)
        ? sourceAnswers.sourceProtocol
        : (sourceAnswers.sourceProtocol ? [sourceAnswers.sourceProtocol] : defaultSourceProtocols),
      workloadType: sourceAnswers.workloadType ?? SOURCE_DETAILS_DEFAULTS.workloadType,
      sourceShareSizeTb: sourceAnswers.sourceShareSizeTb ?? SOURCE_DETAILS_DEFAULTS.sourceShareSizeTb,
      sourceIops: sourceAnswers.sourceIops ?? SOURCE_DETAILS_DEFAULTS.sourceIops,
      sourceThroughputMibps: sourceAnswers.sourceThroughputMibps ?? SOURCE_DETAILS_DEFAULTS.sourceThroughputMibps,
      comfortFactor: sourceAnswers.comfortFactor
        ?? (getDefaultSelectValue(comfortFactorQuestion) || SOURCE_DETAILS_DEFAULTS.comfortFactor),
      assessmentCriteria: sourceAnswers.assessmentCriteria ?? SOURCE_DETAILS_DEFAULTS.assessmentCriteria,
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
    return hasSourceDetailsStep
      && sourceDetailsQuestions.every((sourceQuestion) => isQuestionVisible(sourceQuestion, sourceAnswers));
  }

  function shouldShowBlobInputsStep(sourceAnswers) {
    const selectedServices = Array.isArray(sourceAnswers.targetService)
      ? sourceAnswers.targetService
      : [];

    return hasBlobInputsStep
      && selectedServices.includes("blobs")
      && blobInputQuestions.every((blobQuestion) => isQuestionVisible(blobQuestion, sourceAnswers));
  }

  function shouldShowFilesInputsStep(sourceAnswers) {
    const selectedServices = Array.isArray(sourceAnswers.targetService)
      ? sourceAnswers.targetService
      : [];

    return hasFilesInputsStep
      && selectedServices.includes("files")
      && filesInputQuestions.every((filesQuestion) => isQuestionVisible(filesQuestion, sourceAnswers));
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
      targetService: value === "netapp"
        ? prev.targetService
        : prev.targetService.filter((service) => service !== "anf"),
    }));
  }

  function toggleCommonTargetService(value) {
    setCommonValues((prev) => ({
      ...prev,
      targetService: prev.targetService.includes(value)
        ? prev.targetService.filter((service) => service !== value)
        : [...prev.targetService, value],
    }));
  }

  function handleCommonContinue() {
    const prevCommon = getCommonAnswersSnapshot(answers);
    const commonChanged = JSON.stringify(prevCommon) !== JSON.stringify(commonValues);

    let updated = {
      ...answers,
      ...commonValues,
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

  const regionQuestion = commonQuestions.find((q) => q.id === "region");
  const nasQuestion = commonQuestions.find((q) => q.id === "nas");
  const targetServiceQuestion = commonQuestions.find((q) => q.id === "targetService");
  const redundancyQuestion = commonQuestions.find((q) => q.id === "redundancy");
  const sourceProtocolQuestion = sourceDetailsQuestions.find((q) => q.id === "sourceProtocol");
  const sourceWorkloadTypeQuestion = sourceDetailsQuestions.find((q) => q.id === "workloadType");
  const sourceShareSizeQuestion = sourceDetailsQuestions.find((q) => q.id === "sourceShareSizeTb");
  const sourceIopsQuestion = sourceDetailsQuestions.find((q) => q.id === "sourceIops");
  const sourceThroughputQuestion = sourceDetailsQuestions.find((q) => q.id === "sourceThroughputMibps");
  const comfortFactorQuestion = sourceDetailsQuestions.find((q) => q.id === "comfortFactor");
  const assessmentCriteriaQuestion = sourceDetailsQuestions.find((q) => q.id === "assessmentCriteria");
  const blobWorkloadTypeQuestion = blobInputQuestions.find((q) => q.id === "blobWorkloadType");
  const blobAccessFrequencyQuestion = blobInputQuestions.find((q) => q.id === "blobAccessFrequency");
  const filesMediaTypeQuestion = filesInputQuestions.find((q) => q.id === "filesMediaType");

  const visibleSourceProtocolOptions = sourceProtocolQuestion
    ? getVisibleOptions(sourceProtocolQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleSourceWorkloadTypeOptions = sourceWorkloadTypeQuestion
    ? getVisibleOptions(sourceWorkloadTypeQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleComfortFactorOptions = comfortFactorQuestion
    ? getVisibleOptions(comfortFactorQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleAssessmentCriteriaOptions = assessmentCriteriaQuestion
    ? getVisibleOptions(assessmentCriteriaQuestion.options, {
        ...answers,
        ...sourceDetailsValues,
      })
    : [];

  const visibleCommonServiceOptions = targetServiceQuestion
    ? getVisibleOptions(targetServiceQuestion.options, {
        ...answers,
        ...commonValues,
      })
    : [];

  const visibleBlobWorkloadOptions = blobWorkloadTypeQuestion
    ? getVisibleOptions(blobWorkloadTypeQuestion.options, {
        ...answers,
        ...blobInputValues,
      })
    : [];

  const visibleBlobFrequencyOptions = blobAccessFrequencyQuestion
    ? getVisibleOptions(blobAccessFrequencyQuestion.options, {
        ...answers,
        ...blobInputValues,
      })
    : [];

  const visibleFilesMediaOptions = filesMediaTypeQuestion
    ? getVisibleOptions(filesMediaTypeQuestion.options, {
        ...answers,
        ...filesInputValues,
      })
    : [];

  const isCommonValid =
    commonValues.region &&
    commonValues.nas &&
    commonValues.redundancy &&
    commonValues.targetService.length > 0;

  const isSourceDetailsValid =
    Array.isArray(sourceDetailsValues.sourceProtocol) &&
    sourceDetailsValues.sourceProtocol.length > 0 &&
    sourceDetailsValues.workloadType &&
    isPositiveNumber(sourceDetailsValues.sourceShareSizeTb) &&
    isPositiveNumber(sourceDetailsValues.sourceIops) &&
    isPositiveNumber(sourceDetailsValues.sourceThroughputMibps) &&
    sourceDetailsValues.comfortFactor &&
    sourceDetailsValues.assessmentCriteria;

  const isBlobInputsValid =
    blobInputValues.blobWorkloadType &&
    blobInputValues.blobAccessFrequency;

  const isFilesInputsValid =
    Array.isArray(filesInputValues.filesMediaType)
    && filesInputValues.filesMediaType.length > 0;

  const commonAnswered =
    answers.region !== undefined &&
    answers.nas !== undefined &&
    answers.targetService !== undefined &&
    answers.redundancy !== undefined;

  const sourceDetailsAnswered =
    answers.sourceProtocol !== undefined &&
    answers.workloadType !== undefined &&
    answers.sourceShareSizeTb !== undefined &&
    answers.sourceIops !== undefined &&
    answers.sourceThroughputMibps !== undefined &&
    answers.comfortFactor !== undefined &&
    answers.assessmentCriteria !== undefined;

  const blobInputsAnswered =
    answers.blobWorkloadType !== undefined &&
    answers.blobAccessFrequency !== undefined;

  const filesInputsAnswered =
    answers.filesMediaType !== undefined;

  const commonSummaryLabel = [
    regionQuestion ? resolveLabel(regionQuestion, answers.region) : "",
    nasQuestion ? resolveLabel(nasQuestion, answers.nas) : "",
    targetServiceQuestion ? resolveLabel(targetServiceQuestion, answers.targetService) : "",
    redundancyQuestion ? resolveLabel(redundancyQuestion, answers.redundancy) : "",
  ].filter(Boolean).join(" | ");

  const sourceDetailsSummaryLabel = [
    sourceProtocolQuestion ? resolveLabel(sourceProtocolQuestion, answers.sourceProtocol) : "",
    sourceWorkloadTypeQuestion ? resolveLabel(sourceWorkloadTypeQuestion, answers.workloadType) : "",
    sourceShareSizeQuestion && answers.sourceShareSizeTb !== undefined ? `${answers.sourceShareSizeTb} GB` : "",
    sourceIopsQuestion && answers.sourceIops !== undefined ? `${answers.sourceIops} IOPS` : "",
    sourceThroughputQuestion && answers.sourceThroughputMibps !== undefined ? `${answers.sourceThroughputMibps} MiB/s` : "",
    comfortFactorQuestion ? resolveLabel(comfortFactorQuestion, answers.comfortFactor) : "",
    assessmentCriteriaQuestion ? resolveLabel(assessmentCriteriaQuestion, answers.assessmentCriteria) : "",
  ].filter(Boolean).join(" | ");

  const blobInputsSummaryLabel = [
    blobWorkloadTypeQuestion ? resolveLabel(blobWorkloadTypeQuestion, answers.blobWorkloadType) : "",
    blobAccessFrequencyQuestion ? resolveLabel(blobAccessFrequencyQuestion, answers.blobAccessFrequency) : "",
  ].filter(Boolean).join(" | ");

  const filesInputsSummaryLabel = [
    filesMediaTypeQuestion ? resolveLabel(filesMediaTypeQuestion, answers.filesMediaType) : "",
  ].filter(Boolean).join(" | ");

  const showSourceDetailsStep = shouldShowSourceDetailsStep(answers);
  const showBlobInputsStep = shouldShowBlobInputsStep(answers);
  const showFilesInputsStep = shouldShowFilesInputsStep(answers);

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
          <span className="answered-label">Common questions</span>
          <span className="answered-value">{commonSummaryLabel}</span>
        </div>
      )}

      {!isCommonStep && !isSourceDetailsStep && showSourceDetailsStep && sourceDetailsAnswered && (
        <div className="answered-card source-details-answered-card">
          <span className="answered-label">Enter your source share details</span>
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
          <h2 className="question-text">Common questions</h2>
          <p className="question-note">These answers apply across Azure Files and Azure Blob recommendations.</p>

          <div className="common-grid">
            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="common-region">{regionQuestion?.text}</label>
              <select
                id="common-region"
                className="select-input"
                value={commonValues.region}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, region: e.target.value }))}
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

            <div className="common-field">
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

            <div className="common-field">
              <label className="common-field-label" htmlFor="common-redundancy">{redundancyQuestion?.text}</label>
              <select
                id="common-redundancy"
                className="select-input"
                value={commonValues.redundancy}
                onChange={(e) => setCommonValues((prev) => ({ ...prev, redundancy: e.target.value }))}
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
                  <label key={opt.value} className={`checkbox-label${commonValues.targetService.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={commonValues.targetService.includes(opt.value)}
                      onChange={() => toggleCommonTargetService(opt.value)}
                    />
                    <span className="checkbox-text">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <button
            className="continue-btn"
            disabled={!isCommonValid}
            onClick={handleCommonContinue}
          >
            Continue →
          </button>

          {hasCommonStep && (
            <button className="back-btn" onClick={handleBack}>
              ← Back
            </button>
          )}
        </div>
      ) : isSourceDetailsStep ? (
        <div className="card source-details-card" ref={activeRef}>
          <p className="step-label">Step {stepNumber}</p>
          <h2 className="question-text">Enter your source share details</h2>
          <p className="question-note">Provide source-share metrics and criteria used in recommendation calculations.</p>

          <div className="common-grid source-details-grid">
            <div className="common-field common-field--full">
              <p className="common-field-label">{sourceProtocolQuestion?.text}</p>
              <p className="multiselect-hint">Select all that apply</p>
              <div className="checkbox-list common-checkbox-list">
                {visibleSourceProtocolOptions.map((opt) => (
                  <label key={opt.value} className={`checkbox-label${sourceDetailsValues.sourceProtocol.includes(opt.value) ? " checked" : ""}`}>
                    <input
                      type="checkbox"
                      className="checkbox-input"
                      checked={sourceDetailsValues.sourceProtocol.includes(opt.value)}
                      onChange={() => setSourceDetailsValues((prev) => ({
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
              <label className="common-field-label" htmlFor="source-workload-type">{sourceWorkloadTypeQuestion?.text}</label>
              <select
                id="source-workload-type"
                className="select-input"
                value={sourceDetailsValues.workloadType}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, workloadType: e.target.value }))}
              >
                {sourceWorkloadTypeQuestion?.placeholder && (
                  <option value="" disabled>{sourceWorkloadTypeQuestion.placeholder}</option>
                )}
                {visibleSourceWorkloadTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
                value={sourceDetailsValues.sourceShareSizeTb}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, sourceShareSizeTb: e.target.value }))}
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
                value={sourceDetailsValues.sourceIops}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, sourceIops: e.target.value }))}
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
                value={sourceDetailsValues.sourceThroughputMibps}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, sourceThroughputMibps: e.target.value }))}
              />
            </div>

            <div className="common-field common-field--full">
              <label className="common-field-label" htmlFor="comfort-factor">{comfortFactorQuestion?.text}</label>
              <select
                id="comfort-factor"
                className="select-input"
                value={sourceDetailsValues.comfortFactor}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, comfortFactor: e.target.value }))}
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
                value={sourceDetailsValues.assessmentCriteria}
                onChange={(e) => setSourceDetailsValues((prev) => ({ ...prev, assessmentCriteria: e.target.value }))}
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
              <label className="common-field-label" htmlFor="blob-workload-type">{blobWorkloadTypeQuestion?.text}</label>
              <select
                id="blob-workload-type"
                className="select-input"
                value={blobInputValues.blobWorkloadType}
                onChange={(e) => setBlobInputValues((prev) => ({ ...prev, blobWorkloadType: e.target.value }))}
              >
                {blobWorkloadTypeQuestion?.placeholder && (
                  <option value="" disabled>{blobWorkloadTypeQuestion.placeholder}</option>
                )}
                {visibleBlobWorkloadOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

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
          <h2 className="question-text">{question.text}</h2>
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
