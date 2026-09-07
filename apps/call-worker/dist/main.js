var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.ts
function raw(name) {
  const value = process.env[name]?.trim();
  return value === "" ? void 0 : value;
}
function required(name, enabled, fallback = "") {
  const value = raw(name);
  if (value) return value;
  if (!enabled) return fallback;
  throw new Error(`${name} is required when local capture is enabled`);
}
function boolean(name, enabled, fallback) {
  const value = raw(name);
  if (value === void 0) {
    if (!enabled) return fallback;
    throw new Error(`${name} is required when local capture is enabled`);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be exactly true or false`);
}
function transcriptionProvider() {
  const value = raw("CALL_NOTES_TRANSCRIPTION_PROVIDER") ?? "openai";
  if (value === "openai" || value === "azure_speech") return value;
  throw new Error("CALL_NOTES_TRANSCRIPTION_PROVIDER must be openai or azure_speech");
}
function integer(name, enabled, fallback, predicate, description) {
  const value = raw(name);
  if (value === void 0) {
    if (!enabled) return fallback;
    throw new Error(`${name} is required when local capture is enabled`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || !predicate(parsed)) {
    throw new Error(`${name} must be a ${description}`);
  }
  return parsed;
}
function optionalInteger(name, _enabled, fallback, predicate, description) {
  const value = raw(name);
  if (value === void 0) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || !predicate(parsed)) {
    throw new Error(`${name} must be a ${description}`);
  }
  return parsed;
}
function number(name, enabled, fallback, predicate, description) {
  const value = raw(name);
  if (value === void 0) {
    if (!enabled) return fallback;
    throw new Error(`${name} is required when local capture is enabled`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !predicate(parsed)) {
    throw new Error(`${name} must be ${description}`);
  }
  return parsed;
}
function origin(name, enabled) {
  const value = required(name, enabled);
  if (!value) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(`${name} must be a valid HTTP(S) origin`);
  }
  return parsed.origin;
}
function endpoint(name, enabled) {
  const value = required(name, enabled);
  if (!value) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }
  return parsed.toString().replace(/\/$/, "");
}
function loadCallWorkerConfig() {
  const captureEnabled = boolean("CALL_NOTES_CAPTURE_ENABLED", false, false);
  const systemAudioEnabled = boolean(
    "CALL_NOTES_SYSTEM_AUDIO_ENABLED",
    false,
    process.platform === "darwin"
  );
  const audioFrameMs = integer(
    "CALL_NOTES_AUDIO_FRAME_MS",
    captureEnabled,
    20,
    (value) => value > 0 && value <= 1e3,
    "positive integer no greater than 1000"
  );
  const audioSampleRate = integer(
    "CALL_NOTES_AUDIO_SAMPLE_RATE",
    captureEnabled,
    16e3,
    (value) => value >= 8e3 && value <= 192e3,
    "integer between 8000 and 192000"
  );
  const vadActivationFrames = integer(
    "CALL_NOTES_VAD_ACTIVATION_FRAMES",
    captureEnabled,
    3,
    (value) => value > 0 && value <= 1e4,
    "positive integer no greater than 10000"
  );
  const vadReleaseFrames = optionalInteger(
    "CALL_NOTES_VAD_RELEASE_FRAMES",
    captureEnabled,
    15,
    (value) => value > 0 && value <= 1e5,
    "positive integer no greater than 100000"
  );
  const audioPreRollMs = optionalInteger(
    "CALL_NOTES_AUDIO_PRE_ROLL_MS",
    captureEnabled,
    200,
    (value) => value >= 0 && value <= 6e4,
    "nonnegative integer no greater than 60000"
  );
  const audioReadyTimeoutMs = optionalInteger(
    "CALL_NOTES_AUDIO_READY_TIMEOUT_MS",
    captureEnabled,
    1e4,
    (value) => value > 0 && value <= 12e4,
    "positive integer no greater than 120000"
  );
  const stopDrainTimeoutMs = optionalInteger(
    "CALL_NOTES_STOP_DRAIN_TIMEOUT_MS",
    captureEnabled,
    3e4,
    (value) => value > 0 && value <= 3e5,
    "positive integer no greater than 300000"
  );
  const transcriptionTimeoutMs = optionalInteger(
    "CALL_NOTES_TRANSCRIPTION_TIMEOUT_MS",
    captureEnabled,
    2e4,
    (value) => value > 0 && value <= 3e5,
    "positive integer no greater than 300000"
  );
  const utteranceMaxMs = optionalInteger(
    "CALL_NOTES_UTTERANCE_MAX_MS",
    captureEnabled,
    3e3,
    (value) => value >= audioFrameMs && value <= 36e5,
    `an integer between ${audioFrameMs} and 3600000`
  );
  const language = raw("CALL_NOTES_TRANSCRIPTION_LANGUAGE");
  const configuredTranscriptionProvider = transcriptionProvider();
  const webOrigin = origin("CALL_NOTES_WEB_ORIGIN", captureEnabled);
  const internalToken = required("CALL_NOTES_INTERNAL_TOKEN", captureEnabled);
  const companyId = required("CALL_NOTES_LOCAL_COMPANY_ID", captureEnabled);
  const userId = required("CALL_NOTES_LOCAL_USER_ID", captureEnabled);
  if (captureEnabled && !/^\d+$/.test(companyId)) {
    throw new Error("CALL_NOTES_LOCAL_COMPANY_ID must contain only digits");
  }
  if (captureEnabled && userId.length > 256) {
    throw new Error("CALL_NOTES_LOCAL_USER_ID must be at most 256 characters");
  }
  const ffmpegPath = required("CALL_NOTES_FFMPEG_PATH", captureEnabled, "ffmpeg");
  const audioInputFormat = required("CALL_NOTES_AUDIO_INPUT_FORMAT", captureEnabled);
  const audioInputDevice = required("CALL_NOTES_AUDIO_INPUT_DEVICE", captureEnabled);
  const systemAudioHelperPath = required(
    "CALL_NOTES_SYSTEM_AUDIO_HELPER_PATH",
    captureEnabled && systemAudioEnabled
  );
  return {
    captureEnabled,
    webOrigin,
    internalToken,
    companyId,
    userId,
    ffmpegPath,
    audioInputFormat,
    audioInputDevice,
    systemAudioEnabled,
    systemAudioHelperPath,
    audioSampleRate,
    audioFrameMs,
    vadThreshold: number(
      "CALL_NOTES_VAD_THRESHOLD",
      captureEnabled,
      0.015,
      (value) => value >= 0 && value <= 1,
      "a finite number between 0 and 1"
    ),
    vadActivationFrames,
    vadReleaseFrames,
    utteranceMaxMs,
    audioPreRollMs,
    audioReadyTimeoutMs,
    stopDrainTimeoutMs,
    transcriptionTimeoutMs,
    transcriptionProvider: configuredTranscriptionProvider,
    transcriptionBaseUrl: endpoint("CALL_NOTES_TRANSCRIPTION_BASE_URL", captureEnabled),
    transcriptionModel: required(
      "CALL_NOTES_TRANSCRIPTION_MODEL",
      captureEnabled && configuredTranscriptionProvider === "openai"
    ),
    transcriptionApiKey: required("CALL_NOTES_TRANSCRIPTION_API_KEY", captureEnabled),
    ...language ? { transcriptionLanguage: language } : {},
    autoEnrich: boolean("CALL_NOTES_AUTO_ENRICH", false, false)
  };
}

// src/worker.ts
import { randomUUID } from "node:crypto";

// src/local/pipeline.ts
import { createHash } from "node:crypto";

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../../packages/features/src/call-notes/contracts.ts
var CALL_NOTES_SCHEMA_VERSION = "call-notes/v2";
var CALL_NOTES_ENRICHMENT_SCHEMA_VERSION = "call-notes-enrichment/v1";
var IdSchema = external_exports.string().min(1).max(64);
var SourceKeySchema = external_exports.string().min(1).max(256);
var TimestampSchema = external_exports.string().datetime({ offset: true });
var CompanyIdSchema = external_exports.string().regex(/^\d+$/);
var MarkdownSchema = external_exports.string().max(12e4);
var RichTextSchema = external_exports.record(external_exports.unknown());
var CallNotesSourceSchema = external_exports.literal("local_audio");
var AudioChannelSchema = external_exports.enum(["microphone", "system"]);
var CallStatusSchema = external_exports.enum(["active", "finalizing", "completed", "failed"]);
var CaptureDesiredModeSchema = external_exports.enum(["running", "paused", "stopped"]);
var CaptureLifecycleSchema = external_exports.enum([
  "connecting",
  "live",
  "interrupted",
  "finalizing",
  "completed",
  "failed"
]);
var CaptureOutcomeSchema = external_exports.enum(["complete", "partial", "failed"]);
var CaptureAttemptLifecycleSchema = external_exports.enum([
  "connecting",
  "live",
  "reconnecting",
  "ended",
  "failed"
]);
var GapKindSchema = external_exports.enum([
  "user_paused",
  "capture_user_absent",
  "transport_interruption",
  "worker_unavailable",
  "capture_unknown"
]);
var NoteVisibilitySchema = external_exports.enum(["company", "private"]);
var EnrichmentStatusSchema = external_exports.enum([
  "queued",
  "generating",
  "ready",
  "rejected",
  "accepted",
  "failed"
]);
var ParticipantIdentitySchema = external_exports.object({
  sourceParticipantKey: SourceKeySchema,
  sourceSessionKey: SourceKeySchema.optional(),
  displayName: external_exports.string().min(1).max(512)
});
var CaptureSourceCapabilitiesSchema = external_exports.object({
  attributedTranscript: external_exports.boolean(),
  nativePauseResume: external_exports.boolean(),
  transportReconnect: external_exports.boolean(),
  observesCaptureUserReturn: external_exports.boolean()
});
var CaptureEventBaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  eventId: IdSchema,
  source: CallNotesSourceSchema,
  sourceOccurrenceKey: SourceKeySchema,
  sourceAttemptKey: SourceKeySchema.optional(),
  occurredAt: TimestampSchema
});
var CaptureEventSchema = external_exports.discriminatedUnion("kind", [
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_connected"),
    sourceAttemptKey: SourceKeySchema,
    sourceStreamKey: SourceKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_paused"),
    sourceAttemptKey: SourceKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_resumed"),
    sourceAttemptKey: SourceKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transport_interrupted"),
    sourceAttemptKey: SourceKeySchema,
    reason: external_exports.string().max(512).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transport_reconnected"),
    sourceAttemptKey: SourceKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_ended"),
    sourceAttemptKey: SourceKeySchema,
    reason: external_exports.enum(["silence_timeout", "user_stopped", "source_stopped"])
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_failed"),
    sourceAttemptKey: SourceKeySchema,
    code: external_exports.string().min(1).max(128),
    message: external_exports.string().max(1024).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.enum(["participant_joined", "participant_left", "participant_returned"]),
    sourceAttemptKey: SourceKeySchema,
    participant: ParticipantIdentitySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transcript_segment"),
    sourceAttemptKey: SourceKeySchema,
    sourcePacketHash: external_exports.string().regex(/^[a-f0-9]{64}$/),
    sourceKind: external_exports.literal("derived_asr"),
    audioChannel: AudioChannelSchema,
    participant: external_exports.null(),
    sourceStartMs: external_exports.number().int().nonnegative().optional(),
    sourceEndMs: external_exports.number().int().nonnegative().optional(),
    receivedAt: TimestampSchema,
    receiveOrder: external_exports.number().int().nonnegative(),
    text: external_exports.string().min(1).max(2e4),
    language: external_exports.string().min(1).max(32).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("occurrence_ended"),
    reason: external_exports.string().max(512).optional()
  })
]);
var StartCaptureInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  source: CallNotesSourceSchema,
  sourceOccurrenceKey: SourceKeySchema,
  sourceAttemptKey: SourceKeySchema,
  captureUser: ParticipantIdentitySchema
});
var CaptureControlInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  source: CallNotesSourceSchema,
  sourceOccurrenceKey: SourceKeySchema,
  sourceAttemptKey: SourceKeySchema
});
var TranscriptSegmentSchema = external_exports.object({
  id: IdSchema,
  attemptId: IdSchema,
  audioChannel: AudioChannelSchema,
  participantId: IdSchema.nullable(),
  speakerName: external_exports.string().min(1).max(512).nullable(),
  sourceStartMs: external_exports.number().int().nonnegative().nullable(),
  sourceEndMs: external_exports.number().int().nonnegative().nullable(),
  receivedAt: TimestampSchema,
  receiveOrder: external_exports.number().int().nonnegative(),
  text: external_exports.string().min(1).max(2e4),
  language: external_exports.string().min(1).max(32).nullable()
});
var GapSchema = external_exports.object({
  id: IdSchema,
  attemptId: IdSchema.nullable(),
  kind: GapKindSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable()
});
var CallNoteSchema = external_exports.object({
  documentNoteId: external_exports.number().int().positive().nullable(),
  ownerUserId: external_exports.string().min(1).max(256).nullable(),
  visibility: NoteVisibilitySchema,
  knowledgeIncluded: external_exports.boolean(),
  revision: external_exports.number().int().nonnegative(),
  title: external_exports.string().max(512),
  contentMarkdown: MarkdownSchema,
  contentRich: RichTextSchema,
  saveState: external_exports.enum(["saved", "saving", "failed"])
});
var EnrichedNoteProposalSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
  chronologicalSections: external_exports.array(
    external_exports.object({
      heading: external_exports.string().min(1).max(256).describe("A natural topic heading from this call, not a template heading."),
      markdown: external_exports.string().min(1).max(2e4).describe(
        "Complete topic summary. Rewrite user shorthand into polished prose, never quote it or discuss how it matches the transcript. Use **bold** ONLY for ideas present in currentOwnerCallNote's body; if that body is empty, no bold is permitted. Transcript-only details stay unbolded. Integrate decisions, follow-ups, and any note/transcript discrepancy here, not in appendices."
      ),
      ownerContextLabels: external_exports.array(external_exports.string().min(1).max(512)).max(20).default([]).describe(
        "Metadata for integrated user ideas, never a substitute for inline paraphrases."
      )
    })
  ).min(1).max(100).describe("The entire visible note: topic sections ordered as the conversation unfolded."),
  summary: external_exports.string().min(1).max(2e4).describe("Metadata synopsis of the chronological note; not a separate visible section."),
  decisions: external_exports.array(
    external_exports.object({
      text: external_exports.string().min(1).max(2e3)
    })
  ).max(100),
  actionItems: external_exports.array(
    external_exports.object({
      text: external_exports.string().min(1).max(2e3),
      ownerName: external_exports.string().min(1).max(512).nullable(),
      dueDate: external_exports.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
    })
  ).max(100),
  conflicts: external_exports.array(
    external_exports.object({
      ownerText: external_exports.string().min(1).max(4e3),
      explanation: external_exports.string().min(1).max(4e3)
    })
  ).max(100)
});
var ModelMetadataSchema = external_exports.object({
  provider: external_exports.string().min(1).max(128),
  model: external_exports.string().min(1).max(256),
  promptVersion: external_exports.string().min(1).max(128),
  completionId: external_exports.string().min(1).max(256).optional()
});
var EnrichmentRunSchema = external_exports.object({
  id: IdSchema,
  status: EnrichmentStatusSchema,
  baseNoteRevision: external_exports.number().int().nonnegative(),
  transcriptFingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  proposal: EnrichedNoteProposalSchema.nullable(),
  modelMetadata: ModelMetadataSchema.nullable(),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable()
}).superRefine((run, context) => {
  const requiresArtifacts = run.status === "ready" || run.status === "accepted" || run.status === "rejected";
  if (requiresArtifacts && run.proposal === null) {
    context.addIssue({
      code: "custom",
      path: ["proposal"],
      message: `${run.status} enrichment requires a proposal`
    });
  }
  if (requiresArtifacts && run.modelMetadata === null) {
    context.addIssue({
      code: "custom",
      path: ["modelMetadata"],
      message: `${run.status} enrichment requires model metadata`
    });
  }
  if ((run.status === "accepted" || run.status === "rejected") && run.resolvedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAt"],
      message: `${run.status} enrichment requires a resolution timestamp`
    });
  }
});
var ViewerCapabilitiesSchema = external_exports.object({
  canEditNote: external_exports.boolean(),
  canControlCapture: external_exports.boolean(),
  canRequestEnrichment: external_exports.boolean(),
  canResolveEnrichment: external_exports.boolean(),
  canChangeVisibility: external_exports.boolean(),
  canChangeKnowledgeInclusion: external_exports.boolean(),
  canDelete: external_exports.boolean()
});
var CaptureSnapshotSchema = external_exports.object({
  id: IdSchema,
  desiredMode: CaptureDesiredModeSchema,
  lifecycle: CaptureLifecycleSchema,
  outcome: CaptureOutcomeSchema.nullable(),
  activeAttemptId: IdSchema.nullable(),
  attemptCount: external_exports.number().int().nonnegative()
});
var LocalCapturePollInputSchema = external_exports.object({
  companyId: CompanyIdSchema,
  userId: external_exports.string().min(1).max(256),
  workerId: IdSchema
}).strict();
var LocalCaptureWorkerStatusSchema = external_exports.object({
  available: external_exports.boolean(),
  lastSeenAt: TimestampSchema.nullable()
}).strict();
var LocalCaptureSessionSchema = external_exports.object({
  callId: IdSchema,
  captureId: IdSchema,
  occurrenceKey: SourceKeySchema,
  attemptKey: SourceKeySchema,
  startedAt: TimestampSchema,
  title: external_exports.string().min(1).max(512),
  desiredMode: CaptureDesiredModeSchema
}).strict();
var LocalCapturePollResultSchema = external_exports.object({
  capture: LocalCaptureSessionSchema.nullable()
}).strict();
var CallSnapshotSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  id: IdSchema,
  companyId: CompanyIdSchema,
  source: CallNotesSourceSchema,
  sourceOccurrenceKey: SourceKeySchema,
  title: external_exports.string().min(1).max(512),
  status: CallStatusSchema,
  capture: CaptureSnapshotSchema,
  viewerCapabilities: ViewerCapabilitiesSchema,
  transcript: external_exports.array(TranscriptSegmentSchema),
  gaps: external_exports.array(GapSchema),
  note: CallNoteSchema.nullable(),
  enrichment: EnrichmentRunSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).superRefine((snapshot, context) => {
  if (snapshot.note === null && snapshot.enrichment !== null) {
    context.addIssue({
      code: "custom",
      path: ["enrichment"],
      message: "Private-note projections must redact enrichment"
    });
  }
});
var DetectedCallCandidateSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  source: CallNotesSourceSchema,
  sourceOccurrenceKey: SourceKeySchema,
  title: external_exports.string().min(1).max(512),
  detectedAt: TimestampSchema,
  endsAt: TimestampSchema.nullable()
});
var UserCommandBaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  requestId: IdSchema,
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256)
});
var CallNotesCommandSchema = external_exports.discriminatedUnion("kind", [
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("start_capture"),
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema,
    title: external_exports.string().min(1).max(512).optional()
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("dismiss_detected_occurrence"),
    source: CallNotesSourceSchema,
    sourceOccurrenceKey: SourceKeySchema
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("pause_capture"), callId: IdSchema }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("resume_capture"), callId: IdSchema }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("stop_capture"), callId: IdSchema }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("update_note"),
    callId: IdSchema,
    baseRevision: external_exports.number().int().nonnegative(),
    title: external_exports.string().max(512),
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("set_note_visibility"),
    callId: IdSchema,
    visibility: NoteVisibilitySchema
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("request_enrichment"), callId: IdSchema }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("reject_enrichment"),
    callId: IdSchema,
    enrichmentRunId: IdSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("accept_enrichment"),
    callId: IdSchema,
    enrichmentRunId: IdSchema,
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("set_knowledge_inclusion"),
    callId: IdSchema,
    included: external_exports.boolean()
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("delete_call"), callId: IdSchema })
]);
var CallQuerySchema = external_exports.object({
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256),
  callId: IdSchema
});
var CallListQuerySchema = external_exports.object({
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256),
  limit: external_exports.number().int().min(1).max(100).default(50)
});
var TranscriptSearchQuerySchema = CallQuerySchema.extend({
  query: external_exports.string().min(1).max(512)
});
var EnrichmentInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
  callId: IdSchema,
  transcriptFingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  transcript: external_exports.array(TranscriptSegmentSchema).min(1),
  gaps: external_exports.array(GapSchema),
  note: CallNoteSchema
});
var EnrichmentResultSchema = external_exports.object({
  proposal: EnrichedNoteProposalSchema,
  modelMetadata: ModelMetadataSchema
});
var KnowledgeNoteSchema = external_exports.object({
  companyId: CompanyIdSchema,
  callId: IdSchema,
  documentNoteId: external_exports.number().int().positive(),
  ownerUserId: external_exports.string().min(1).max(256),
  revision: external_exports.number().int().positive(),
  title: external_exports.string().max(512),
  contentMarkdown: MarkdownSchema,
  deepLink: external_exports.string().min(1).max(2048)
});
var CompleteEnrichmentInputSchema = external_exports.object({
  companyId: CompanyIdSchema,
  callId: IdSchema,
  enrichmentRunId: IdSchema,
  result: EnrichmentResultSchema
});

// src/local/audio.ts
import { spawn as nodeSpawn } from "node:child_process";
import { PassThrough } from "node:stream";
var DEFAULT_SAMPLE_RATE = 16e3;
var DEFAULT_FRAME_DURATION_MS = 20;
var DEFAULT_STDERR_LIMIT = 4096;
var DEFAULT_STATUS_TIMEOUT_MS = 2e3;
var MAX_STATUS_TIMEOUT_MS = 3e4;
var STATUS_STDOUT_LIMIT = 16384;
var STATUS_SHUTDOWN_GRACE_MS = 250;
function asError(value) {
  return value instanceof Error ? value : new Error(String(value));
}
function positiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
function nonEmpty(value, name) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}
function frameLayout(options) {
  const sampleRate = positiveInteger("sampleRate", options.sampleRate ?? DEFAULT_SAMPLE_RATE);
  const configuredFrameBytes = options.frameBytes;
  if (configuredFrameBytes !== void 0) {
    positiveInteger("frameBytes", configuredFrameBytes);
    if (configuredFrameBytes % 2 !== 0) {
      throw new RangeError("frameBytes must contain complete 16-bit samples");
    }
  }
  const configuredFrameSamples = options.frameSamples;
  if (configuredFrameSamples !== void 0) {
    positiveInteger("frameSamples", configuredFrameSamples);
  }
  if (configuredFrameBytes !== void 0 && configuredFrameSamples !== void 0 && configuredFrameBytes !== configuredFrameSamples * 2) {
    throw new RangeError("frameBytes and frameSamples must describe the same frame");
  }
  const frameDurationMs = options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
  if (!Number.isFinite(frameDurationMs) || frameDurationMs <= 0) {
    throw new RangeError("frameDurationMs must be a positive finite number");
  }
  const frameSamples = configuredFrameSamples ?? (configuredFrameBytes !== void 0 ? configuredFrameBytes / 2 : Math.max(1, Math.round(sampleRate * frameDurationMs / 1e3)));
  const frameBytes = configuredFrameBytes ?? frameSamples * 2;
  return {
    sampleRate,
    frameSamples,
    frameBytes,
    frameDurationMs: frameSamples * 1e3 / sampleRate
  };
}
function processExit(child) {
  let exited = false;
  let settled = false;
  let resolveExit = () => void 0;
  const promise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  child.once("error", (error) => {
    if (settled) return;
    settled = true;
    resolveExit({ code: null, signal: null, error: asError(error) });
  });
  child.once("close", (code, signal) => {
    exited = true;
    if (settled) return;
    settled = true;
    resolveExit({ code, signal });
  });
  return { promise, hasExited: () => exited };
}
function stopProcess(child, hasExited) {
  if (hasExited()) return;
  try {
    child.kill("SIGTERM");
  } catch {
  }
  const forceKillTimer = setTimeout(() => {
    if (hasExited()) return;
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }, 2e3);
  forceKillTimer.unref?.();
}
function addAbortHandler(child, signal, hasExited) {
  let aborted = signal.aborted;
  let forceKillTimer;
  const stop = () => {
    aborted = true;
    if (hasExited()) return;
    try {
      child.kill("SIGTERM");
    } catch {
    }
    forceKillTimer = setTimeout(() => {
      if (hasExited()) return;
      try {
        child.kill("SIGKILL");
      } catch {
      }
    }, 2e3);
    forceKillTimer.unref?.();
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  return {
    wasAborted: () => aborted || signal.aborted,
    dispose: () => {
      signal.removeEventListener("abort", stop);
      if (forceKillTimer !== void 0) clearTimeout(forceKillTimer);
    }
  };
}
async function waitForProcessAfterStop(completion, child, hasExited) {
  if (hasExited()) return;
  await Promise.race([
    completion.then(() => void 0),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, STATUS_SHUTDOWN_GRACE_MS);
      timer.unref?.();
    })
  ]);
  if (!hasExited()) {
    try {
      child.kill("SIGKILL");
    } catch {
    }
  }
}
var FfmpegPcmSourceError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "FfmpegPcmSourceError";
  }
};
var SystemAudioPcmSourceError = class extends Error {
  code;
  readiness;
  constructor(message, options = {}) {
    super(message, options);
    this.name = "SystemAudioPcmSourceError";
    this.code = options.code ?? "capture_failed";
    this.readiness = options.readiness;
  }
};
var PROCESS_PCM_BUFFER_BYTES = 4 * 1024 * 1024;
async function* readProcessPcmFrames(options, signal) {
  if (signal.aborted) return;
  let child;
  try {
    const spawnOptions = {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    };
    child = options.spawn(options.executable, [...options.args], spawnOptions);
  } catch (error) {
    throw options.createError(`Unable to spawn ${options.label}: ${asError(error).message}`, {
      cause: error
    });
  }
  if (!child.stdout || !child.stderr) {
    stopProcess(child, () => false);
    throw options.createError(`${options.label} must provide stdout and stderr pipes`);
  }
  const pcmOutput = new PassThrough({ highWaterMark: PROCESS_PCM_BUFFER_BYTES });
  child.stdout.pipe(pcmOutput);
  const forwardStdoutError = (error) => {
    pcmOutput.destroy(error);
  };
  child.stdout.on("error", forwardStdoutError);
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-DEFAULT_STDERR_LIMIT);
  });
  const completion = processExit(child);
  let stopped = false;
  const stop = () => {
    stopped = true;
    stopProcess(child, completion.hasExited);
  };
  options.registerStop?.(stop);
  const abort = addAbortHandler(child, signal, completion.hasExited);
  let streamError;
  let frameBuffer = new Uint8Array(options.frameBytes);
  let frameOffset = 0;
  let emittedSamples = 0;
  const startedAt = options.clock();
  const startedAtMs = startedAt.getTime();
  if (!Number.isFinite(startedAtMs)) {
    abort.dispose();
    options.unregisterStop?.(stop);
    stopProcess(child, completion.hasExited);
    throw options.createError("capture clock returned an invalid date");
  }
  try {
    for await (const chunk of pcmOutput) {
      if (stopped || abort.wasAborted()) return;
      if (!(chunk instanceof Uint8Array)) {
        throw options.createError(`${options.label} stdout yielded a non-byte chunk`);
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const copyLength = Math.min(
          options.frameBytes - frameOffset,
          chunk.byteLength - offset
        );
        frameBuffer.set(chunk.subarray(offset, offset + copyLength), frameOffset);
        frameOffset += copyLength;
        offset += copyLength;
        if (frameOffset !== options.frameBytes) continue;
        if (stopped || abort.wasAborted()) return;
        const pcm = frameBuffer;
        frameBuffer = new Uint8Array(options.frameBytes);
        frameOffset = 0;
        const capturedAt = new Date(
          startedAtMs + emittedSamples * 1e3 / options.sampleRate
        );
        emittedSamples += options.frameSamples;
        yield {
          pcm,
          capturedAt,
          durationMs: options.frameDurationMs
        };
      }
    }
  } catch (error) {
    streamError = error;
  } finally {
    child.stdout.unpipe(pcmOutput);
    child.stdout.off("error", forwardStdoutError);
    pcmOutput.destroy();
    abort.dispose();
    options.unregisterStop?.(stop);
    if (!completion.hasExited()) stopProcess(child, completion.hasExited);
  }
  const exit = await completion.promise;
  if (stopped || abort.wasAborted()) return;
  if (streamError !== void 0) {
    throw options.createError(
      `Unable to read ${options.label} PCM output: ${asError(streamError).message}`,
      { cause: streamError }
    );
  }
  if (exit.error) {
    throw options.createError(`Unable to spawn ${options.label}: ${exit.error.message}`, {
      cause: exit.error
    });
  }
  if (exit.code !== 0) {
    const details = stderrTail.trim();
    throw options.createError(
      `${options.label} exited with code ${String(exit.code)}${details ? `: ${details}` : ""}`
    );
  }
  if (exit.signal !== null) {
    const details = stderrTail.trim();
    throw options.createError(
      `${options.label} exited due to signal ${exit.signal}${details ? `: ${details}` : ""}`
    );
  }
  if (frameOffset !== 0) {
    if (frameOffset % 2 !== 0) {
      throw options.createError(`${options.label} produced an incomplete 16-bit PCM sample`);
    }
    const sampleCount = frameOffset / 2;
    const pcm = frameBuffer.slice(0, frameOffset);
    frameBuffer.fill(0);
    frameBuffer = new Uint8Array(0);
    yield {
      pcm,
      capturedAt: new Date(startedAtMs + emittedSamples * 1e3 / options.sampleRate),
      durationMs: sampleCount * 1e3 / options.sampleRate
    };
  }
}
var FfmpegPcmSource = class {
  ffmpegPath;
  input;
  inputFormat;
  sampleRate;
  frameSamples;
  frameBytes;
  frameDurationMs;
  args;
  extraArgs;
  clock;
  spawnProcess;
  activeStops = /* @__PURE__ */ new Set();
  constructor(inputOrOptions = {}, positionalOptions = {}) {
    const options = typeof inputOrOptions === "string" ? { ...positionalOptions, input: inputOrOptions } : inputOrOptions;
    this.ffmpegPath = nonEmpty(options.ffmpegPath ?? "ffmpeg", "ffmpegPath");
    this.input = nonEmpty(
      options.input ?? options.device ?? options.inputDevice ?? (process.platform === "darwin" ? ":0" : "default"),
      "input"
    );
    this.inputFormat = nonEmpty(
      options.inputFormat ?? options.format ?? (process.platform === "darwin" ? "avfoundation" : "alsa"),
      "inputFormat"
    );
    const layout = frameLayout(options);
    this.sampleRate = layout.sampleRate;
    this.frameSamples = layout.frameSamples;
    this.frameBytes = layout.frameBytes;
    this.frameDurationMs = layout.frameDurationMs;
    this.args = options.args === void 0 ? void 0 : [...options.args];
    this.extraArgs = options.extraArgs === void 0 ? [] : [...options.extraArgs];
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.spawnProcess = options.spawn ?? nodeSpawn;
  }
  frames(signal) {
    return readProcessPcmFrames(
      {
        executable: this.ffmpegPath,
        args: this.buildArgs(),
        label: "ffmpeg",
        sampleRate: this.sampleRate,
        frameSamples: this.frameSamples,
        frameBytes: this.frameBytes,
        frameDurationMs: this.frameDurationMs,
        clock: this.clock,
        spawn: this.spawnProcess,
        createError: (message, options) => new FfmpegPcmSourceError(message, options),
        registerStop: (stop) => this.activeStops.add(stop),
        unregisterStop: (stop) => this.activeStops.delete(stop)
      },
      signal
    );
  }
  stop() {
    for (const stop of this.activeStops) stop();
  }
  buildArgs() {
    if (this.args !== void 0) return [...this.args];
    return [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-f",
      this.inputFormat,
      "-i",
      this.input,
      "-ac",
      "1",
      "-ar",
      String(this.sampleRate),
      ...this.extraArgs,
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      "pipe:1"
    ];
  }
};
function statusDiagnostic(code, message, supported = false, authorized = false) {
  return { ready: code === "ready", code, supported, authorized, message };
}
function parseSystemAudioStatus(stdout) {
  let value;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return statusDiagnostic("invalid_status", "system audio helper returned invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper status must be a JSON object"
    );
  }
  const record = value;
  if (typeof record.supported !== "boolean" || typeof record.authorized !== "boolean") {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper status must contain boolean supported and authorized fields"
    );
  }
  if (record.reason !== "ready" && record.reason !== "unsupported" && record.reason !== "permission_denied") {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper status must contain a stable reason"
    );
  }
  if (typeof record.message !== "string" || record.message.length > 4096) {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper status must contain a bounded message"
    );
  }
  const supported = record.supported;
  const authorized = record.authorized;
  if (record.reason === "ready" && (!supported || !authorized)) {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper reported ready without support and authorization",
      supported,
      authorized
    );
  }
  if (record.reason === "unsupported" && supported) {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper reported unsupported while supported",
      supported,
      authorized
    );
  }
  if (record.reason === "permission_denied" && (!supported || authorized)) {
    return statusDiagnostic(
      "invalid_status",
      "system audio helper reported denied permission inconsistently",
      supported,
      authorized
    );
  }
  return {
    ready: supported && authorized && record.reason === "ready",
    code: record.reason,
    supported,
    authorized,
    message: record.message
  };
}
async function probeSystemAudioStatusProcess(options) {
  if (options.signal.aborted) {
    return statusDiagnostic("cancelled", "system audio status probe was cancelled");
  }
  let child;
  try {
    child = options.spawn(options.helperPath, ["--status"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return statusDiagnostic(
      "helper_unavailable",
      `unable to spawn system audio helper: ${asError(error).message}`
    );
  }
  if (!child.stdout || !child.stderr) {
    stopProcess(child, () => false);
    return statusDiagnostic(
      "helper_unavailable",
      "system audio helper must provide stdout and stderr pipes"
    );
  }
  let stdout = "";
  let stderr = "";
  let outputTooLarge = false;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    if (outputTooLarge) return;
    stdout += chunk;
    if (Buffer.byteLength(stdout, "utf8") > STATUS_STDOUT_LIMIT) {
      outputTooLarge = true;
      stdout = stdout.slice(0, STATUS_STDOUT_LIMIT);
      try {
        child.kill("SIGTERM");
      } catch {
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-DEFAULT_STDERR_LIMIT);
  });
  const completion = processExit(child);
  let timedOut = false;
  let cancelled = options.signal.aborted;
  let timeout;
  let removeAbort;
  const stopForProbe = () => {
    if (!completion.hasExited()) {
      try {
        child.kill("SIGTERM");
      } catch {
      }
    }
  };
  options.registerStop?.(stopForProbe);
  const abortPromise = new Promise((resolve) => {
    const onAbort = () => {
      cancelled = true;
      stopForProbe();
      resolve("cancelled");
    };
    if (options.signal.aborted) onAbort();
    else {
      options.signal.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => options.signal.removeEventListener("abort", onAbort);
    }
  });
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      stopForProbe();
      resolve("timeout");
    }, options.timeoutMs);
    timeout.unref?.();
  });
  try {
    const result = await Promise.race([
      completion.promise.then((exit2) => ({ kind: "exit", exit: exit2 })),
      abortPromise.then((kind) => ({ kind })),
      timeoutPromise.then((kind) => ({ kind }))
    ]);
    if (result.kind !== "exit") {
      await waitForProcessAfterStop(completion.promise, child, completion.hasExited);
      if (result.kind === "cancelled" || cancelled) {
        return statusDiagnostic("cancelled", "system audio status probe was cancelled");
      }
      return statusDiagnostic(
        "status_timeout",
        `system audio status probe timed out after ${options.timeoutMs}ms`
      );
    }
    const exit = result.exit;
    if (outputTooLarge) {
      return statusDiagnostic(
        "invalid_status",
        "system audio helper status exceeded the output limit"
      );
    }
    if (exit.error) {
      return statusDiagnostic(
        "helper_unavailable",
        `unable to run system audio helper: ${exit.error.message}`
      );
    }
    if (exit.signal !== null) {
      return statusDiagnostic(
        "status_failed",
        `system audio status exited due to signal ${exit.signal}`
      );
    }
    const readiness = parseSystemAudioStatus(stdout);
    const expectedExitCode = readiness.code === "ready" ? 0 : readiness.code === "permission_denied" ? 2 : readiness.code === "unsupported" ? 3 : void 0;
    if (expectedExitCode === void 0) return readiness;
    if (exit.code !== expectedExitCode) {
      const detail = stderr.trim();
      return statusDiagnostic(
        "status_failed",
        `system audio status reported ${readiness.code} but exited with code ${String(exit.code)}${detail ? `: ${detail}` : ""}`,
        readiness.supported,
        readiness.authorized
      );
    }
    return readiness;
  } finally {
    if (timeout !== void 0) clearTimeout(timeout);
    removeAbort?.();
    options.unregisterStop?.(stopForProbe);
    if (timedOut || cancelled)
      await waitForProcessAfterStop(completion.promise, child, completion.hasExited);
  }
}
var SystemAudioPcmSource = class {
  helperPath;
  sampleRate;
  frameSamples;
  frameBytes;
  frameDurationMs;
  statusTimeoutMs;
  clock;
  spawnProcess;
  activeStops = /* @__PURE__ */ new Set();
  readinessPromise;
  constructor(options) {
    this.helperPath = nonEmpty(options.helperPath, "helperPath");
    const layout = frameLayout({
      sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
      frameDurationMs: options.frameDurationMs,
      frameSamples: options.frameSamples,
      frameBytes: options.frameBytes
    });
    this.sampleRate = layout.sampleRate;
    this.frameSamples = layout.frameSamples;
    this.frameBytes = layout.frameBytes;
    this.frameDurationMs = layout.frameDurationMs;
    this.statusTimeoutMs = options.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.statusTimeoutMs) || this.statusTimeoutMs <= 0 || this.statusTimeoutMs > MAX_STATUS_TIMEOUT_MS) {
      throw new RangeError(
        `statusTimeoutMs must be a positive integer no greater than ${MAX_STATUS_TIMEOUT_MS}`
      );
    }
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.spawnProcess = options.spawn ?? nodeSpawn;
  }
  async probeStatus(signal = new AbortController().signal) {
    if (signal.aborted) {
      return statusDiagnostic("cancelled", "system audio status probe was cancelled");
    }
    this.readinessPromise ??= probeSystemAudioStatusProcess({
      helperPath: this.helperPath,
      timeoutMs: this.statusTimeoutMs,
      spawn: this.spawnProcess,
      signal,
      registerStop: (stop) => this.activeStops.add(stop),
      unregisterStop: (stop) => this.activeStops.delete(stop)
    });
    return this.readinessPromise;
  }
  frames(signal) {
    return this.captureFrames(signal);
  }
  async *captureFrames(signal) {
    if (signal.aborted) return;
    const readiness = await this.probeStatus(signal);
    if (signal.aborted || readiness.code === "cancelled") return;
    if (!readiness.ready) {
      throw new SystemAudioPcmSourceError(
        `System audio is not ready (${readiness.code}): ${readiness.message}`,
        { code: readiness.code, readiness }
      );
    }
    yield* readProcessPcmFrames(
      {
        executable: this.helperPath,
        args: ["--sample-rate", String(this.sampleRate)],
        label: "system audio helper",
        sampleRate: this.sampleRate,
        frameSamples: this.frameSamples,
        frameBytes: this.frameBytes,
        frameDurationMs: this.frameDurationMs,
        clock: this.clock,
        spawn: this.spawnProcess,
        createError: (message, options) => new SystemAudioPcmSourceError(message, { ...options, code: "capture_failed" }),
        registerStop: (stop) => this.activeStops.add(stop),
        unregisterStop: (stop) => this.activeStops.delete(stop)
      },
      signal
    );
    if (!signal.aborted) {
      throw new SystemAudioPcmSourceError("system audio helper stopped unexpectedly", {
        code: "capture_failed"
      });
    }
  }
  stop() {
    for (const stop of this.activeStops) stop();
  }
};
function writeAscii(target, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}
function assertWavRate(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
function encodePcm16Wav(pcm, sampleRateOrOptions, channels = 1) {
  if (!(pcm instanceof Uint8Array)) {
    throw new TypeError("pcm must be a Uint8Array");
  }
  const sampleRate = typeof sampleRateOrOptions === "number" ? sampleRateOrOptions : sampleRateOrOptions.sampleRate;
  if (typeof sampleRateOrOptions !== "number") {
    channels = sampleRateOrOptions.channels ?? 1;
  }
  assertWavRate("sampleRate", sampleRate);
  if (!Number.isSafeInteger(channels) || channels <= 0 || channels > 65535) {
    throw new RangeError("channels must be a positive 16-bit integer");
  }
  const blockAlign = channels * 2;
  if (pcm.byteLength % blockAlign !== 0) {
    throw new RangeError("PCM byte length must contain complete samples for every channel");
  }
  const maxPayloadBytes = 4294967295 - 36;
  if (pcm.byteLength > maxPayloadBytes) {
    throw new RangeError("PCM payload is too large for a RIFF/WAVE file");
  }
  const wav = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(wav.buffer);
  writeAscii(wav, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(wav, 8, "WAVE");
  writeAscii(wav, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(wav, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, 44);
  return wav;
}

// src/local/vad.ts
var DEFAULT_THRESHOLD = 0.015;
var DEFAULT_ACTIVATION_FRAMES = 3;
var DEFAULT_RELEASE_FRAMES = 25;
function positiveInteger2(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}
function nonnegativeFinite(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative finite number`);
  }
  return value;
}
function calculateRms(pcm) {
  if (!(pcm instanceof Uint8Array)) {
    throw new TypeError("frame.pcm must be a Uint8Array");
  }
  if (pcm.byteLength % 2 !== 0) {
    throw new RangeError("frame.pcm must contain complete 16-bit samples");
  }
  if (pcm.byteLength === 0) return 0;
  let sumSquares = 0;
  for (let offset = 0; offset < pcm.byteLength; offset += 2) {
    const unsigned = pcm[offset] | pcm[offset + 1] << 8;
    const signed = unsigned >= 32768 ? unsigned - 65536 : unsigned;
    const normalized = signed / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / (pcm.byteLength / 2));
}
var VoiceActivityDetector = class {
  threshold;
  activationFrames;
  releaseFrames;
  releaseSilenceMs;
  frameDurationMs;
  activeState = false;
  consecutiveSpeechFrames = 0;
  consecutiveSilenceFrames = 0;
  consecutiveSilenceMs = 0;
  constructor(options = {}) {
    const threshold = options.threshold ?? options.speechThreshold ?? DEFAULT_THRESHOLD;
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new RangeError("threshold must be a finite number between 0 and 1");
    }
    this.threshold = threshold;
    this.activationFrames = positiveInteger2(
      "activationFrames",
      options.activationFrames ?? DEFAULT_ACTIVATION_FRAMES
    );
    if (options.releaseFrames !== void 0) {
      this.releaseFrames = positiveInteger2("releaseFrames", options.releaseFrames);
    } else if (options.releaseSilenceMs === void 0) {
      this.releaseFrames = DEFAULT_RELEASE_FRAMES;
    }
    if (options.releaseSilenceMs !== void 0) {
      this.releaseSilenceMs = nonnegativeFinite("releaseSilenceMs", options.releaseSilenceMs);
      if (this.releaseSilenceMs <= 0) {
        throw new RangeError("releaseSilenceMs must be greater than zero");
      }
    }
    if (options.frameDurationMs !== void 0) {
      this.frameDurationMs = nonnegativeFinite("frameDurationMs", options.frameDurationMs);
      if (this.frameDurationMs <= 0) {
        throw new RangeError("frameDurationMs must be greater than zero");
      }
    }
  }
  get active() {
    return this.activeState;
  }
  process(frame) {
    if (!frame || typeof frame !== "object") {
      throw new TypeError("frame is required");
    }
    const rms = calculateRms(frame.pcm);
    const speaking = rms >= this.threshold;
    let started = false;
    let ended = false;
    if (!this.activeState) {
      this.consecutiveSilenceFrames = 0;
      this.consecutiveSilenceMs = 0;
      if (speaking) {
        this.consecutiveSpeechFrames += 1;
        if (this.consecutiveSpeechFrames >= this.activationFrames) {
          this.activeState = true;
          this.consecutiveSpeechFrames = 0;
          started = true;
        }
      } else {
        this.consecutiveSpeechFrames = 0;
      }
    } else if (speaking) {
      this.consecutiveSilenceFrames = 0;
      this.consecutiveSilenceMs = 0;
    } else {
      this.consecutiveSpeechFrames = 0;
      this.consecutiveSilenceFrames += 1;
      this.consecutiveSilenceMs += this.durationFor(frame);
      const reachedFrameRelease = this.releaseFrames !== void 0 && this.consecutiveSilenceFrames >= this.releaseFrames;
      const reachedTimeRelease = this.releaseSilenceMs !== void 0 && this.consecutiveSilenceMs >= this.releaseSilenceMs;
      if (reachedFrameRelease || reachedTimeRelease) {
        this.activeState = false;
        this.consecutiveSilenceFrames = 0;
        this.consecutiveSilenceMs = 0;
        ended = true;
      }
    }
    return {
      active: this.activeState,
      started,
      ended,
      rms
    };
  }
  reset() {
    this.activeState = false;
    this.consecutiveSpeechFrames = 0;
    this.consecutiveSilenceFrames = 0;
    this.consecutiveSilenceMs = 0;
  }
  durationFor(frame) {
    return typeof frame.durationMs === "number" && Number.isFinite(frame.durationMs) && frame.durationMs > 0 ? frame.durationMs : this.frameDurationMs ?? 0;
  }
};

// src/local/transcription.ts
var DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
var DEFAULT_MODEL = "whisper-1";
var DEFAULT_TIMEOUT_MS = 2e4;
var MAX_ERROR_BODY_LENGTH = 4096;
function asError2(value) {
  return value instanceof Error ? value : new Error(String(value));
}
function requiredText(value, name) {
  const result = value?.trim();
  if (!result) throw new Error(`${name} is required`);
  return result;
}
function checkedTimeout(value, name = "timeoutMs") {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}
function endpointFor(baseUrl) {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (!normalized) throw new Error("baseUrl is required");
  return /\/audio\/transcriptions(?:[/?]|$)/.test(normalized) ? normalized : `${normalized}/audio/transcriptions`;
}
function abortReason(signal) {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "transcription request aborted", {
    cause: reason
  });
}
function responseText(response) {
  return response.text().then((text) => text.slice(0, MAX_ERROR_BODY_LENGTH)).catch(() => "");
}
var OpenAiCompatibleTranscriptionModel = class {
  endpoint;
  model;
  apiKey;
  timeoutMs;
  fetchImpl;
  constructor(optionsOrBaseUrl = {}, positionalModel, positionalApiKey) {
    const options = typeof optionsOrBaseUrl === "string" ? {
      baseUrl: optionsOrBaseUrl,
      model: positionalModel,
      apiKey: positionalApiKey
    } : optionsOrBaseUrl;
    const configuredBaseUrl = options.baseUrl ?? options.baseURL ?? options.endpoint ?? process.env.CALL_NOTES_TRANSCRIPTION_BASE_URL ?? process.env.AI_BASE_URL ?? DEFAULT_BASE_URL;
    const configuredModel = options.model ?? options.modelId ?? process.env.CALL_NOTES_TRANSCRIPTION_MODEL ?? process.env.AI_TRANSCRIPTION_MODEL ?? DEFAULT_MODEL;
    const configuredApiKey = options.apiKey ?? process.env.CALL_NOTES_TRANSCRIPTION_API_KEY ?? process.env.AI_API_KEY;
    this.endpoint = endpointFor(requiredText(configuredBaseUrl, "baseUrl"));
    this.model = requiredText(configuredModel, "model");
    const apiKey = configuredApiKey?.trim();
    this.apiKey = apiKey === "" ? void 0 : apiKey;
    this.timeoutMs = checkedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("global fetch is unavailable");
    }
  }
  async transcribe(input, requestOptions = {}) {
    if (!input || typeof input !== "object") {
      throw new TypeError("transcription input is required");
    }
    if (!(input.audioWav instanceof Uint8Array)) {
      throw new TypeError("audioWav must be a Uint8Array");
    }
    if (input.audioWav.byteLength === 0) {
      throw new Error("audioWav must not be empty");
    }
    const externalSignal = requestOptions.signal ?? input.signal;
    if (externalSignal?.aborted) throw abortReason(externalSignal);
    const timeoutMs = checkedTimeout(
      requestOptions.timeoutMs ?? input.timeoutMs ?? this.timeoutMs
    );
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => {
      controller.abort(externalSignal?.reason);
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`transcription request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
      "audio.wav"
    );
    form.append("model", this.model);
    if (typeof input.language === "string" && input.language.trim()) {
      form.append("language", input.language.trim());
    }
    const headers = {};
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: form,
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await responseText(response);
        throw new Error(
          `transcription request failed (${response.status})${detail ? `: ${detail}` : ""}`
        );
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(
          `transcription response was not valid JSON: ${asError2(error).message}`,
          { cause: error }
        );
      }
      if (payload === null || typeof payload !== "object" || !("text" in payload) || typeof payload.text !== "string") {
        throw new Error("transcription response must contain a text string");
      }
      const text = payload.text;
      if (!text.trim()) {
        throw new Error("transcription response text must not be empty");
      }
      return text;
    } catch (error) {
      if (timedOut) {
        throw new Error(`transcription request timed out after ${timeoutMs}ms`, {
          cause: error
        });
      }
      if (externalSignal?.aborted) throw abortReason(externalSignal);
      throw error;
    } finally {
      if (timeout !== void 0) clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromCaller);
      }
    }
  }
};
var DEFAULT_AZURE_SPEECH_API_VERSION = "2025-10-15";
function azureSpeechEndpoint(endpoint2, apiVersion) {
  const url = new URL(requiredText(endpoint2, "endpoint"));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("endpoint must use HTTP(S)");
  }
  if (url.pathname === "/" || url.pathname === "") {
    url.pathname = "/speechtotext/transcriptions:transcribe";
  } else if (!url.pathname.endsWith("/speechtotext/transcriptions:transcribe")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/speechtotext/transcriptions:transcribe`;
  }
  if (!url.searchParams.has("api-version")) {
    url.searchParams.set("api-version", requiredText(apiVersion, "apiVersion"));
  }
  return url.toString();
}
var AzureSpeechFastTranscriptionModel = class {
  endpoint;
  apiKey;
  timeoutMs;
  fetchImpl;
  constructor(options) {
    this.endpoint = azureSpeechEndpoint(
      options.endpoint,
      options.apiVersion ?? DEFAULT_AZURE_SPEECH_API_VERSION
    );
    this.apiKey = requiredText(options.apiKey, "apiKey");
    this.timeoutMs = checkedTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("global fetch is unavailable");
    }
  }
  async transcribe(input, requestOptions = {}) {
    if (!input || typeof input !== "object") {
      throw new TypeError("transcription input is required");
    }
    if (!(input.audioWav instanceof Uint8Array)) {
      throw new TypeError("audioWav must be a Uint8Array");
    }
    if (input.audioWav.byteLength === 0) {
      throw new Error("audioWav must not be empty");
    }
    const externalSignal = requestOptions.signal ?? input.signal;
    if (externalSignal?.aborted) throw abortReason(externalSignal);
    const timeoutMs = checkedTimeout(
      requestOptions.timeoutMs ?? input.timeoutMs ?? this.timeoutMs
    );
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => {
      controller.abort(externalSignal?.reason);
    };
    if (externalSignal) {
      externalSignal.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`transcription request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
    const form = new FormData();
    form.append(
      "audio",
      new Blob([new Uint8Array(input.audioWav)], { type: "audio/wav" }),
      "audio.wav"
    );
    form.append(
      "definition",
      JSON.stringify({
        ...input.language?.trim() ? { locales: [input.language.trim()] } : {}
      })
    );
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Ocp-Apim-Subscription-Key": this.apiKey },
        body: form,
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await responseText(response);
        throw new Error(
          `transcription request failed (${response.status})${detail ? `: ${detail}` : ""}`
        );
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(
          `transcription response was not valid JSON: ${asError2(error).message}`,
          { cause: error }
        );
      }
      if (payload === null || typeof payload !== "object" || !("combinedPhrases" in payload) || !Array.isArray(payload.combinedPhrases)) {
        throw new Error("transcription response must contain combinedPhrases");
      }
      const text = payload.combinedPhrases.map(
        (phrase) => phrase !== null && typeof phrase === "object" && "text" in phrase && typeof phrase.text === "string" ? phrase.text.trim() : ""
      ).filter(Boolean).join(" ");
      return text;
    } catch (error) {
      if (timedOut) {
        throw new Error(`transcription request timed out after ${timeoutMs}ms`, {
          cause: error
        });
      }
      if (externalSignal?.aborted) throw abortReason(externalSignal);
      throw error;
    } finally {
      clearTimeout(timeout);
      if (externalSignal) {
        externalSignal.removeEventListener("abort", abortFromCaller);
      }
    }
  }
};

// src/local/backend-client.ts
var LOCAL_ENDPOINT_PATH = "/api/internal/call-notes/local";
function validOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Local backend origin must be a valid HTTP(S) origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local backend origin must be a valid HTTP(S) origin");
  }
  return url.origin;
}
function nonempty(name, value) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} must not be empty`);
  return normalized;
}
function checkedTimeout2(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("timeoutMs must be a positive finite number");
  }
  return value;
}
function abortReason2(signal) {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "local backend request aborted", {
    cause: reason
  });
}
var LocalBackendClient = class {
  endpoint;
  token;
  timeoutMs;
  request;
  constructor(options) {
    this.endpoint = new URL(LOCAL_ENDPOINT_PATH, validOrigin(options.webOrigin)).toString();
    this.token = nonempty("Local backend token", options.token);
    this.timeoutMs = checkedTimeout2(options.timeoutMs ?? 3e4);
    this.request = options.fetch ?? fetch;
  }
  async poll(input, signal) {
    const parsedInput = LocalCapturePollInputSchema.parse(input);
    const payload = await this.post({ kind: "poll", ...parsedInput }, true, signal);
    return LocalCapturePollResultSchema.parse(payload);
  }
  async event(input, signal) {
    await this.post({ kind: "event", ...input }, false, signal);
  }
  async finish(input, signal) {
    await this.post({ kind: "finish", ...input }, false, signal);
  }
  async post(body, parseJson = false, externalSignal) {
    if (externalSignal?.aborted) throw abortReason2(externalSignal);
    const controller = new AbortController();
    let timedOut = false;
    let timeout;
    let removeAbortListener;
    const timeoutError = () => new Error(`Local backend request timed out after ${this.timeoutMs}ms`);
    const requestPromise = (async () => {
      const response = await this.request(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) {
        const detail = text.trim().slice(0, 512);
        throw new Error(
          `Local backend returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`
        );
      }
      if (!parseJson || !text.trim()) return void 0;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Local backend returned invalid JSON");
      }
    })();
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        const error = timeoutError();
        controller.abort(error);
        reject(error);
      }, this.timeoutMs);
      timeout.unref?.();
    });
    const abortPromise = externalSignal ? new Promise((_, reject) => {
      const onAbort = () => {
        const reason = abortReason2(externalSignal);
        controller.abort(externalSignal.reason);
        reject(reason);
      };
      externalSignal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => externalSignal.removeEventListener("abort", onAbort);
    }) : void 0;
    try {
      return await Promise.race(
        [requestPromise, timeoutPromise, abortPromise].filter(
          (value) => value !== void 0
        )
      );
    } catch (error) {
      if (timedOut) {
        throw new Error(`Local backend request timed out after ${this.timeoutMs}ms`, {
          cause: error
        });
      }
      if (externalSignal?.aborted) throw abortReason2(externalSignal);
      if (error instanceof Error && error.message.startsWith("Local backend returned")) {
        throw error;
      }
      if (error instanceof Error && error.message === "Local backend returned invalid JSON") {
        throw error;
      }
      throw new Error(
        `Local backend request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        { cause: error }
      );
    } finally {
      if (timeout !== void 0) clearTimeout(timeout);
      removeAbortListener?.();
    }
  }
};

// src/local/pipeline.ts
var LOCAL_SOURCE = "local_audio";
var LOCAL_STREAM_KEY = "local-audio";
var DEFAULT_FRAME_DURATION_MS2 = 20;
var DEFAULT_CLOSE_TIMEOUT_MS = 1e3;
var DEFAULT_AUDIO_READY_TIMEOUT_MS = 1e4;
var DEFAULT_AUDIO_PRE_ROLL_MS = 200;
var DEFAULT_STOP_DRAIN_TIMEOUT_MS = 3e4;
var DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 2e4;
var BEST_EFFORT_FAILURE_TIMEOUT_MS = 250;
var ITERATOR_CLOSE_TIMEOUT_MS = 250;
var MAX_PENDING_TRANSCRIPTIONS = 8;
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function deterministicEventId(event) {
  return sha256(JSON.stringify(event));
}
function frameEndAt(value, durationMs, fallbackDurationMs) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("audio frame capturedAt must be a valid Date");
  }
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : fallbackDurationMs;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new RangeError("audio frame durationMs must be positive");
  }
  return new Date(value.getTime() + duration);
}
function copyFrame(frame, fallbackDurationMs) {
  if (!(frame.pcm instanceof Uint8Array) || frame.pcm.byteLength % 2 !== 0) {
    throw new TypeError("audio frame pcm must be an even-length Uint8Array");
  }
  const startAt = new Date(frame.capturedAt.getTime());
  if (!Number.isFinite(startAt.getTime())) {
    throw new TypeError("audio frame capturedAt must be a valid Date");
  }
  return {
    pcm: new Uint8Array(frame.pcm),
    startAt,
    endAt: frameEndAt(startAt, frame.durationMs, fallbackDurationMs)
  };
}
function validatePcmFrame(frame) {
  if (!frame || typeof frame !== "object") throw new TypeError("audio frame is required");
  if (!(frame.pcm instanceof Uint8Array) || frame.pcm.byteLength === 0) {
    throw new TypeError("audio frame pcm must be a non-empty Uint8Array");
  }
  if (frame.pcm.byteLength % 2 !== 0) {
    throw new TypeError("audio frame pcm must contain complete 16-bit samples");
  }
  if (!(frame.capturedAt instanceof Date) || !Number.isFinite(frame.capturedAt.getTime())) {
    throw new TypeError("audio frame capturedAt must be a valid Date");
  }
  if (frame.durationMs !== void 0 && (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0)) {
    throw new TypeError("audio frame durationMs must be positive");
  }
}
function concatenatePcm(frames) {
  let length = 0;
  for (const frame of frames) length += frame.pcm.byteLength;
  const pcm = new Uint8Array(length);
  let offset = 0;
  for (const frame of frames) {
    pcm.set(frame.pcm, offset);
    offset += frame.pcm.byteLength;
  }
  return pcm;
}
function sourceOffsetMs(origin2, value) {
  return Math.max(0, Math.round(value.getTime() - origin2.getTime()));
}
function newerDate(first, second) {
  return !first || second.getTime() > first.getTime() ? second : first;
}
function abortError(signal, fallback) {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : fallback, { cause: reason });
}
function asError3(value) {
  return value instanceof Error ? value : new Error(String(value));
}
var LocalCapturePipeline = class {
  constructor(options) {
    this.options = options;
    const session = LocalCaptureSessionSchema.parse(options.session);
    if (!options.sources?.microphone) throw new Error("microphone audio source is required");
    if (!options.vads?.microphone) throw new Error("microphone VAD is required");
    if (options.sources.system && !options.vads.system) {
      throw new Error("system VAD is required when system audio is enabled");
    }
    if (options.companyId.trim().length === 0) throw new Error("companyId must not be empty");
    if (options.userId.trim().length === 0) throw new Error("userId must not be empty");
    if (!Number.isSafeInteger(options.sampleRate) || options.sampleRate <= 0) {
      throw new Error("sampleRate must be a positive integer");
    }
    if (!Number.isFinite(options.utteranceMaxMs) || options.utteranceMaxMs <= 0) {
      throw new Error("utteranceMaxMs must be positive");
    }
    this.audioPreRollMs = options.audioPreRollMs ?? DEFAULT_AUDIO_PRE_ROLL_MS;
    if (!Number.isFinite(this.audioPreRollMs) || this.audioPreRollMs < 0) {
      throw new Error("audioPreRollMs must be nonnegative");
    }
    this.audioReadyTimeoutMs = options.audioReadyTimeoutMs ?? DEFAULT_AUDIO_READY_TIMEOUT_MS;
    if (!Number.isFinite(this.audioReadyTimeoutMs) || this.audioReadyTimeoutMs <= 0) {
      throw new Error("audioReadyTimeoutMs must be positive");
    }
    this.stopDrainTimeoutMs = options.stopDrainTimeoutMs ?? DEFAULT_STOP_DRAIN_TIMEOUT_MS;
    if (!Number.isFinite(this.stopDrainTimeoutMs) || this.stopDrainTimeoutMs <= 0) {
      throw new Error("stopDrainTimeoutMs must be positive");
    }
    this.transcriptionTimeoutMs = options.transcriptionTimeoutMs ?? DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
    if (!Number.isFinite(this.transcriptionTimeoutMs) || this.transcriptionTimeoutMs <= 0) {
      throw new Error("transcriptionTimeoutMs must be positive");
    }
    this.closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    if (!Number.isFinite(this.closeTimeoutMs) || this.closeTimeoutMs <= 0) {
      throw new Error("closeTimeoutMs must be positive");
    }
    const startedAt = new Date(session.startedAt);
    if (!Number.isFinite(startedAt.getTime()))
      throw new Error("session.startedAt must be valid");
    this.activeCapture = {
      occurrenceKey: session.occurrenceKey,
      attemptKey: session.attemptKey,
      callId: session.callId,
      startedAt,
      failed: false,
      finished: false,
      failureReported: false
    };
    this.streams = [
      {
        channel: "microphone",
        source: options.sources.microphone,
        vad: options.vads.microphone,
        done: false,
        utterance: [],
        preRoll: []
      },
      ...options.sources.system ? [
        {
          channel: "system",
          source: options.sources.system,
          vad: options.vads.system,
          done: false,
          utterance: [],
          preRoll: []
        }
      ] : []
    ];
  }
  sourceStopController = new AbortController();
  operationAbortController = new AbortController();
  closeTimeoutMs;
  audioReadyTimeoutMs;
  audioPreRollMs;
  stopDrainTimeoutMs;
  transcriptionTimeoutMs;
  streams;
  activeCapture;
  runPromise;
  stopPromise;
  closePromise;
  lastFrameEnd;
  receiveOrder = 0;
  transcriptAppendTail = Promise.resolve();
  pendingFlushes = /* @__PURE__ */ new Set();
  stopRequested = false;
  closeRequested = false;
  captureLost = false;
  fatalError;
  closeFailureCode = "capture_closed";
  finishPromise;
  stopTimeoutError;
  connected = false;
  removeRunSignalListeners = [];
  run(signal) {
    if (signal) {
      const abort = () => {
        this.captureLost = true;
        const reason = abortError(signal, "local capture operation aborted");
        this.stopSources(reason);
        this.operationAbortController.abort(reason);
      };
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        this.removeRunSignalListeners.push(
          () => signal.removeEventListener("abort", abort)
        );
      }
    }
    this.runPromise ??= this.consume();
    return this.runPromise;
  }
  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.closePromise) return this.closePromise;
    this.stopRequested = true;
    this.stopSources(new Error("local capture stopped by user"));
    this.stopPromise = this.finishStop(this.run());
    return this.stopPromise;
  }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closeRequested = true;
    this.captureLost = true;
    const reason = new Error("local capture closed");
    this.closeFailureCode = this.options.session.desiredMode === "paused" ? "capture_paused" : "capture_closed";
    this.stopSources(reason);
    this.operationAbortController.abort(reason);
    const runPromise = this.run();
    this.closePromise = this.finishClose(runPromise);
    return this.closePromise;
  }
  stopSources(reason) {
    for (const state of this.streams) {
      try {
        state.source.stop?.(reason);
      } catch {
      }
    }
    if (!this.sourceStopController.signal.aborted) {
      this.sourceStopController.abort(reason);
    }
  }
  async finishStop(runPromise) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), this.stopDrainTimeoutMs);
    });
    const completedPromise = runPromise.then(
      () => true,
      () => true
    );
    const completed = await Promise.race([completedPromise, timeoutPromise]);
    clearTimeout(timer);
    if (completed) {
      await runPromise;
      return;
    }
    const reason = new Error(
      `local capture stop drain timed out after ${this.stopDrainTimeoutMs}ms`
    );
    this.stopTimeoutError = reason;
    this.captureLost = true;
    this.closeFailureCode = "capture_stop_timeout";
    this.stopSources(reason);
    this.operationAbortController.abort(reason);
    await this.failActiveCall(reason, "capture_stop_timeout");
    void runPromise.catch(() => void 0);
    throw reason;
  }
  async finishClose(runPromise) {
    let timer;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), this.closeTimeoutMs);
      timer.unref?.();
    });
    const completedPromise = runPromise.then(
      () => true,
      () => true
    );
    const completed = await Promise.race([completedPromise, timeoutPromise]);
    clearTimeout(timer);
    if (completed) {
      await runPromise.catch(() => void 0);
      return;
    }
    const reason = new Error("local capture shutdown timed out");
    this.captureLost = true;
    this.stopSources(reason);
    this.operationAbortController.abort(reason);
    await this.failActiveCall(reason, this.closeFailureCode);
    void runPromise.catch(() => void 0);
  }
  async consume() {
    let failure;
    try {
      if (this.options.session.desiredMode === "stopped" && !this.closeRequested) {
        this.stopRequested = true;
        this.stopSources(new Error("capture session is already stopped"));
      }
      if (this.options.session.desiredMode === "paused" && !this.closeRequested) {
        this.closeRequested = true;
        this.captureLost = true;
        this.closeFailureCode = "capture_paused";
        const reason = new Error("capture pause is not supported");
        this.stopSources(reason);
        this.operationAbortController.abort(reason);
      }
      if (!this.closeRequested && !this.stopRequested) {
        try {
          await this.consumeStreams();
        } catch (error) {
          failure = this.fatalError ?? error;
          this.captureLost = true;
          this.stopSources(error);
          this.operationAbortController.abort(error);
        }
      }
      if (!failure && this.fatalError !== void 0) {
        failure = this.fatalError;
        this.captureLost = true;
      }
      if (!failure && this.stopTimeoutError) failure = this.stopTimeoutError;
      try {
        await this.waitForPendingFlushes();
      } catch (error) {
        failure ??= this.fatalError ?? error;
        this.captureLost = true;
        this.stopSources(error);
        this.operationAbortController.abort(error);
      }
      if (!failure && !this.captureLost && !this.closeRequested && !this.activeCapture.failed && this.connected) {
        try {
          await this.finishCall();
        } catch (error) {
          failure = error;
          this.captureLost = true;
          this.stopSources(error);
          this.operationAbortController.abort(error);
        }
      }
      if (this.activeCapture.failed === false && (failure !== void 0 || this.captureLost || this.closeRequested || this.operationAbortController.signal.aborted)) {
        await this.failActiveCall(
          failure ?? this.operationAbortController.signal.reason ?? new Error("local capture operation aborted"),
          this.closeRequested ? this.closeFailureCode : this.stopTimeoutError ? "capture_stop_timeout" : this.connected ? "capture_stream_lost" : "capture_not_ready"
        );
      }
    } finally {
      this.zeroBufferedFrames();
      await this.closeIterators();
      for (const remove of this.removeRunSignalListeners.splice(0)) remove();
    }
    if (failure && !this.closeRequested) throw asError3(failure);
  }
  async consumeStreams() {
    if (this.sourceStopController.signal.aborted) return;
    const pending = /* @__PURE__ */ new Map();
    try {
      for (const state of this.streams) {
        if (this.sourceStopController.signal.aborted) break;
        let iterator;
        try {
          iterator = state.source.frames(this.sourceStopController.signal)[Symbol.asyncIterator]();
        } catch (error) {
          throw new Error(
            `${state.channel} audio source failed: ${asError3(error).message}`,
            { cause: error }
          );
        }
        state.iterator = iterator;
        pending.set(state.channel, this.nextFrame(state));
      }
    } catch (error) {
      this.stopSources(error);
      await this.settlePendingFrames(pending);
      throw error;
    }
    let removeStopListener;
    const stopPromise = new Promise((resolve) => {
      const onAbort = () => resolve({ stopped: true });
      if (this.sourceStopController.signal.aborted) onAbort();
      else {
        this.sourceStopController.signal.addEventListener("abort", onAbort, { once: true });
        removeStopListener = () => this.sourceStopController.signal.removeEventListener("abort", onAbort);
      }
    });
    try {
      const initial = await this.waitForInitialFrames(pending, stopPromise);
      if (!initial || this.sourceStopController.signal.aborted) return;
      for (const pendingFrame of initial) {
        if (pendingFrame.result.done) {
          throw new Error(
            `${pendingFrame.state.channel} audio stream ended before readiness`
          );
        }
        validatePcmFrame(pendingFrame.result.value);
      }
      if (this.sourceStopController.signal.aborted) return;
      await this.appendEvent({
        kind: "attempt_connected",
        sourceAttemptKey: this.activeCapture.attemptKey,
        sourceStreamKey: LOCAL_STREAM_KEY,
        sourceOccurrenceKey: this.activeCapture.occurrenceKey,
        occurredAt: this.activeCapture.startedAt.toISOString()
      });
      this.connected = true;
      pending.clear();
      for (const pendingFrame of initial) {
        if (!pendingFrame.result.done) {
          await this.processFrame(pendingFrame.state, pendingFrame.result.value);
        }
      }
      for (const state of this.streams) {
        if (!this.sourceStopController.signal.aborted) {
          pending.set(state.channel, this.nextFrame(state));
        }
      }
      while (pending.size > 0) {
        const winner = await Promise.race([...pending.values(), stopPromise]);
        if ("stopped" in winner) break;
        pending.delete(winner.state.channel);
        if (winner.result.done) {
          if (this.sourceStopController.signal.aborted) break;
          throw new Error(
            `${winner.state.channel} audio stream ended before explicit stop`
          );
        }
        await this.processFrame(winner.state, winner.result.value);
        if (this.sourceStopController.signal.aborted || winner.state.done) break;
        pending.set(
          winner.state.channel,
          this.nextFrame(stateForChannel(this.streams, winner.state.channel))
        );
      }
    } catch (error) {
      this.stopSources(error);
      throw error;
    } finally {
      removeStopListener?.();
      await this.settlePendingFrames(pending);
    }
  }
  async waitForInitialFrames(pending, stopPromise) {
    const initial = Promise.all([...pending.values()]);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(
          new Error(`audio readiness timed out after ${this.audioReadyTimeoutMs}ms`)
        ),
        this.audioReadyTimeoutMs
      );
      timer.unref?.();
    });
    try {
      return await Promise.race([initial, timeout, stopPromise.then(() => void 0)]);
    } finally {
      clearTimeout(timer);
    }
  }
  async settlePendingFrames(pending) {
    if (pending.size === 0) return;
    const settled = Promise.allSettled([...pending.values()]);
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(resolve, ITERATOR_CLOSE_TIMEOUT_MS);
      timer.unref?.();
    });
    await Promise.race([settled.then(() => void 0), timeout]);
    void settled.then((results) => {
      for (const result of results) {
        if (result.status === "fulfilled" && !result.value.result.done) {
          result.value.result.value.pcm.fill(0);
        }
      }
    });
  }
  async nextFrame(state) {
    if (!state.iterator) throw new Error(`${state.channel} audio source was not initialized`);
    try {
      const result = await state.iterator.next();
      return { state, result };
    } catch (error) {
      throw new Error(`${state.channel} audio source failed: ${asError3(error).message}`, {
        cause: error
      });
    }
  }
  async processFrame(state, frame) {
    this.assertOperationAvailable();
    let buffered;
    try {
      validatePcmFrame(frame);
      buffered = copyFrame(frame, this.options.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS2);
      this.lastFrameEnd = newerDate(this.lastFrameEnd, buffered.endAt);
      const activity = state.vad.process(frame);
      if (activity.active && state.utterance.length === 0) {
        for (const prior of state.preRoll) state.utterance.push(prior);
        state.preRoll = [];
        if (state.utterance.length === 0) {
          state.utteranceStartedAt = buffered.startAt;
        } else {
          state.utteranceStartedAt = state.utterance[0].startAt;
        }
        state.utterance.push(buffered);
        state.utteranceEndedAt = buffered.endAt;
        buffered = void 0;
      } else if (state.utterance.length > 0) {
        state.utterance.push(buffered);
        state.utteranceEndedAt = buffered.endAt;
        buffered = void 0;
      } else {
        this.appendPreRoll(state, buffered);
        buffered = void 0;
      }
      const utteranceStartedAt = state.utteranceStartedAt;
      const utteranceEndedAt = state.utteranceEndedAt;
      if (state.utterance.length > 0 && utteranceStartedAt && utteranceEndedAt && (activity.ended || utteranceEndedAt.getTime() - utteranceStartedAt.getTime() >= this.options.utteranceMaxMs)) {
        this.scheduleUtteranceFlush(state);
      }
    } catch (error) {
      if (buffered && !state.utterance.includes(buffered)) buffered.pcm.fill(0);
      throw error;
    } finally {
      if (frame.pcm instanceof Uint8Array) frame.pcm.fill(0);
    }
  }
  appendPreRoll(state, frame) {
    state.preRoll.push(frame);
    if (this.audioPreRollMs === 0) {
      while (state.preRoll.length > 1) state.preRoll.shift().pcm.fill(0);
      return;
    }
    const cutoff = frame.endAt.getTime() - this.audioPreRollMs;
    while (state.preRoll.length > 1 && state.preRoll[0].endAt.getTime() <= cutoff) {
      state.preRoll.shift().pcm.fill(0);
    }
  }
  scheduleUtteranceFlush(state) {
    if (state.utterance.length === 0) return;
    const frames = state.utterance;
    const startedAt = state.utteranceStartedAt ?? frames[0].startAt;
    const endedAt = state.utteranceEndedAt ?? frames[frames.length - 1].endAt;
    state.utterance = [];
    state.utteranceStartedAt = void 0;
    state.utteranceEndedAt = void 0;
    if (this.activeCapture.failed) {
      for (const frame of frames) frame.pcm.fill(0);
      return;
    }
    if (this.pendingFlushes.size >= MAX_PENDING_TRANSCRIPTIONS) {
      for (const frame of frames) frame.pcm.fill(0);
      throw new Error(
        `transcription fell behind live audio (${MAX_PENDING_TRANSCRIPTIONS} utterances pending)`
      );
    }
    const transcriptPromise = this.transcribeUtterance(
      state.channel,
      frames,
      startedAt,
      endedAt
    );
    const orderedPromise = this.transcriptAppendTail.then(async () => {
      const result = await transcriptPromise;
      try {
        if (!result.text) return;
        this.assertOperationAvailable();
        await this.appendEvent({
          kind: "transcript_segment",
          sourceAttemptKey: result.sourceAttemptKey,
          sourceOccurrenceKey: result.sourceOccurrenceKey,
          sourcePacketHash: result.sourcePacketHash,
          sourceKind: "derived_asr",
          audioChannel: result.audioChannel,
          participant: null,
          sourceStartMs: result.sourceStartMs,
          sourceEndMs: result.sourceEndMs,
          receivedAt: result.receivedAt,
          receiveOrder: this.receiveOrder++,
          text: result.text,
          ...this.options.language ? { language: this.options.language } : {},
          occurredAt: result.occurredAt
        });
      } finally {
        result.pcm.fill(0);
        result.audioWav.fill(0);
      }
    }).finally(() => {
      for (const frame of frames) frame.pcm.fill(0);
    });
    this.transcriptAppendTail = orderedPromise.catch(() => void 0);
    const trackedPromise = orderedPromise.then(
      () => {
        this.pendingFlushes.delete(trackedPromise);
      },
      (error) => {
        this.pendingFlushes.delete(trackedPromise);
        this.recordFatalFailure(error);
        throw error;
      }
    );
    this.pendingFlushes.add(trackedPromise);
    void trackedPromise.catch(() => void 0);
  }
  async transcribeUtterance(audioChannel, frames, startedAt, endedAt) {
    const pcm = concatenatePcm(frames);
    const startMs = sourceOffsetMs(this.activeCapture.startedAt, startedAt);
    const endMs = Math.max(startMs, sourceOffsetMs(this.activeCapture.startedAt, endedAt));
    const sourcePacketHash = sha256(
      `${this.activeCapture.attemptKey}:${audioChannel}:${startMs}:${endMs}:${sha256(pcm)}`
    );
    let audioWav;
    try {
      audioWav = encodePcm16Wav(pcm, this.options.sampleRate);
      const text = await this.options.transcription.transcribe(
        {
          audioWav,
          ...this.options.language ? { language: this.options.language } : {},
          timeoutMs: this.transcriptionTimeoutMs
        },
        {
          signal: this.operationAbortController.signal,
          timeoutMs: this.transcriptionTimeoutMs
        }
      );
      return {
        text,
        sourceAttemptKey: this.activeCapture.attemptKey,
        sourceOccurrenceKey: this.activeCapture.occurrenceKey,
        sourcePacketHash,
        sourceStartMs: startMs,
        sourceEndMs: endMs,
        receivedAt: endedAt.toISOString(),
        occurredAt: endedAt.toISOString(),
        audioChannel,
        pcm,
        audioWav
      };
    } catch (error) {
      pcm.fill(0);
      audioWav?.fill(0);
      throw error;
    }
  }
  recordFatalFailure(error) {
    if (!this.closeRequested && this.fatalError === void 0) this.fatalError = error;
    if (this.closeRequested) return;
    this.captureLost = true;
    this.stopSources(error);
    this.operationAbortController.abort(error);
  }
  async waitForPendingFlushes() {
    while (this.pendingFlushes.size > 0) {
      const pending = [...this.pendingFlushes];
      const results = await Promise.allSettled(pending);
      const failed = results.find(
        (result) => result.status === "rejected"
      );
      if (failed) throw failed.reason;
    }
    await this.transcriptAppendTail;
  }
  async finishCall() {
    if (this.finishPromise) return this.finishPromise;
    if (this.activeCapture.finished || this.activeCapture.failed) return;
    const finishing = (async () => {
      for (const state of this.streams) this.scheduleUtteranceFlush(state);
      await this.waitForPendingFlushes();
      this.assertOperationAvailable();
      await this.appendEvent({
        kind: "attempt_ended",
        sourceAttemptKey: this.activeCapture.attemptKey,
        sourceOccurrenceKey: this.activeCapture.occurrenceKey,
        reason: "user_stopped",
        occurredAt: (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString()
      });
      await this.appendEvent({
        kind: "occurrence_ended",
        sourceOccurrenceKey: this.activeCapture.occurrenceKey,
        occurredAt: (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString(),
        reason: "user_stopped"
      });
      this.assertOperationAvailable();
      await this.options.backend.finish(
        {
          companyId: this.options.companyId,
          userId: this.options.userId,
          callId: this.activeCapture.callId,
          autoEnrich: this.options.autoEnrich
        },
        this.operationAbortController.signal
      );
      this.assertOperationAvailable();
      if (this.closeRequested || this.operationAbortController.signal.aborted) {
        throw new Error("local capture closed while finishing");
      }
      this.activeCapture.finished = true;
    })();
    this.finishPromise = finishing;
    try {
      await finishing;
    } finally {
      if (this.finishPromise === finishing) this.finishPromise = void 0;
    }
  }
  async failActiveCall(error, code) {
    if (this.activeCapture.finished || this.activeCapture.failureReported) {
      this.zeroBufferedFrames();
      return;
    }
    this.activeCapture.failed = true;
    this.activeCapture.failureReported = true;
    this.zeroBufferedFrames();
    const failureController = new AbortController();
    const timer = setTimeout(
      () => failureController.abort(new Error("attempt_failed report timed out")),
      BEST_EFFORT_FAILURE_TIMEOUT_MS
    );
    timer.unref?.();
    const occurredAt = (this.lastFrameEnd ?? this.activeCapture.startedAt).toISOString();
    const message = asError3(error).message.slice(0, 1024);
    try {
      await Promise.race([
        this.appendEvent(
          {
            kind: "attempt_failed",
            sourceAttemptKey: this.activeCapture.attemptKey,
            sourceOccurrenceKey: this.activeCapture.occurrenceKey,
            code,
            ...message ? { message } : {},
            occurredAt
          },
          failureController.signal
        ),
        new Promise((resolve) => {
          const timeout = setTimeout(resolve, BEST_EFFORT_FAILURE_TIMEOUT_MS);
          timeout.unref?.();
        })
      ]);
    } catch {
    } finally {
      clearTimeout(timer);
      failureController.abort();
    }
  }
  zeroBufferedFrames() {
    for (const state of this.streams) {
      for (const frame of state.utterance) frame.pcm.fill(0);
      for (const frame of state.preRoll) frame.pcm.fill(0);
      state.utterance = [];
      state.preRoll = [];
      state.utteranceStartedAt = void 0;
      state.utteranceEndedAt = void 0;
    }
  }
  async closeIterators() {
    for (const state of this.streams) state.iterator = void 0;
  }
  async appendEvent(event, signal = this.operationAbortController.signal) {
    this.assertOperationAvailable(signal);
    const completeEvent = {
      ...event,
      schemaVersion: CALL_NOTES_SCHEMA_VERSION,
      source: LOCAL_SOURCE
    };
    const parsed = CaptureEventSchema.parse({
      ...completeEvent,
      eventId: deterministicEventId(completeEvent)
    });
    await this.options.backend.event(
      {
        companyId: this.options.companyId,
        userId: this.options.userId,
        callId: this.activeCapture.callId,
        event: parsed
      },
      signal
    );
    this.assertOperationAvailable(signal);
  }
  assertOperationAvailable(signal = this.operationAbortController.signal) {
    if (signal.aborted) throw abortError(signal, "local capture operation aborted");
    if (signal === this.operationAbortController.signal && this.captureLost) {
      throw new Error("local capture operation aborted");
    }
  }
};
function stateForChannel(streams, channel) {
  const state = streams.find((candidate) => candidate.channel === channel);
  if (!state) throw new Error(`${channel} audio stream was not initialized`);
  return state;
}
function createLocalCapturePipeline(config, session, dependencies = {}) {
  const microphoneSource = dependencies.sources?.microphone ?? new FfmpegPcmSource({
    ffmpegPath: config.ffmpegPath,
    inputFormat: config.audioInputFormat,
    input: config.audioInputDevice,
    sampleRate: config.audioSampleRate,
    frameDurationMs: config.audioFrameMs
  });
  const systemSource = config.systemAudioEnabled ? dependencies.sources?.system ?? new SystemAudioPcmSource({
    helperPath: config.systemAudioHelperPath,
    sampleRate: config.audioSampleRate,
    frameDurationMs: config.audioFrameMs
  }) : dependencies.sources?.system;
  const sources = {
    microphone: microphoneSource,
    ...systemSource ? { system: systemSource } : {}
  };
  const microphoneVad = dependencies.vads?.microphone ?? new VoiceActivityDetector({
    threshold: config.vadThreshold,
    activationFrames: config.vadActivationFrames,
    releaseFrames: config.vadReleaseFrames,
    frameDurationMs: config.audioFrameMs
  });
  const systemVad = sources.system ? dependencies.vads?.system ?? new VoiceActivityDetector({
    threshold: config.vadThreshold,
    activationFrames: config.vadActivationFrames,
    releaseFrames: config.vadReleaseFrames,
    frameDurationMs: config.audioFrameMs
  }) : void 0;
  const vads = {
    microphone: microphoneVad,
    ...systemVad ? { system: systemVad } : {}
  };
  const transcription = dependencies.transcription ?? (config.transcriptionProvider === "azure_speech" ? new AzureSpeechFastTranscriptionModel({
    endpoint: config.transcriptionBaseUrl,
    apiKey: config.transcriptionApiKey,
    timeoutMs: config.transcriptionTimeoutMs
  }) : new OpenAiCompatibleTranscriptionModel({
    baseUrl: config.transcriptionBaseUrl,
    model: config.transcriptionModel,
    apiKey: config.transcriptionApiKey,
    timeoutMs: config.transcriptionTimeoutMs
  }));
  const backend = dependencies.backend ?? new LocalBackendClient({
    webOrigin: config.webOrigin,
    token: config.internalToken
  });
  return new LocalCapturePipeline({
    session,
    sources,
    vads,
    transcription,
    backend,
    companyId: config.companyId,
    userId: config.userId,
    autoEnrich: config.autoEnrich,
    sampleRate: config.audioSampleRate,
    utteranceMaxMs: config.utteranceMaxMs,
    audioPreRollMs: config.audioPreRollMs,
    audioReadyTimeoutMs: config.audioReadyTimeoutMs,
    stopDrainTimeoutMs: config.stopDrainTimeoutMs,
    transcriptionTimeoutMs: config.transcriptionTimeoutMs,
    language: config.transcriptionLanguage,
    frameDurationMs: config.audioFrameMs
  });
}

// src/worker.ts
var MIN_POLL_INTERVAL_MS = 500;
var MAX_POLL_INTERVAL_MS = 1e3;
var DEFAULT_POLL_INTERVAL_MS = 750;
function abortError2(signal) {
  const reason = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === "string" ? reason : "call worker stopped", { cause: reason });
}
function abortableDelay(milliseconds, signal) {
  if (signal.aborted) return Promise.reject(abortError2(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    timer.unref?.();
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortError2(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function boundedPollInterval(value) {
  if (value === void 0) return DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("pollIntervalMs must be a positive finite number");
  }
  return Math.min(MAX_POLL_INTERVAL_MS, Math.max(MIN_POLL_INTERVAL_MS, value));
}
function sameSession(first, second) {
  return first.callId === second.callId && first.captureId === second.captureId && first.occurrenceKey === second.occurrenceKey && first.attemptKey === second.attemptKey;
}
var CallWorkerRuntime = class {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.workerId = dependencies.workerId ?? randomUUID();
    this.pollIntervalMs = boundedPollInterval(dependencies.pollIntervalMs);
    this.sleep = dependencies.sleep ?? abortableDelay;
    this.createPipeline = dependencies.createPipeline ?? createLocalCapturePipeline;
    const backend = dependencies.backend ?? new LocalBackendClient({
      webOrigin: config.webOrigin,
      token: config.internalToken
    });
    if (typeof backend.poll !== "function") {
      throw new Error("call worker backend must implement poll");
    }
    this.backend = backend;
    this.pipelineDependenciesFactory = dependencies.pipelineDependenciesFactory ?? (() => ({
      sources: dependencies.sources,
      vads: dependencies.vads,
      transcription: dependencies.transcription,
      backend: this.backend
    }));
  }
  workerId;
  backend;
  createPipeline;
  pipelineDependenciesFactory;
  pollIntervalMs;
  sleep;
  controlAbortController = new AbortController();
  runPromise;
  closePromise;
  active;
  externalAbortCleanup;
  run(signal) {
    if (signal) {
      const abort = () => {
        this.controlAbortController.abort(abortError2(signal));
        void this.active?.pipeline.close();
      };
      if (signal.aborted) abort();
      else {
        signal.addEventListener("abort", abort, { once: true });
        this.externalAbortCleanup = () => signal.removeEventListener("abort", abort);
      }
    }
    this.runPromise ??= this.pollLoop();
    return this.runPromise;
  }
  async close() {
    if (this.closePromise) return this.closePromise;
    this.controlAbortController.abort(new Error("call worker closed"));
    this.externalAbortCleanup?.();
    this.externalAbortCleanup = void 0;
    this.closePromise = (async () => {
      await this.active?.pipeline.close();
      await this.runPromise?.catch(() => void 0);
    })();
    return this.closePromise;
  }
  async pollLoop() {
    const signal = this.controlAbortController.signal;
    try {
      while (!signal.aborted) {
        const result = await this.poll(signal);
        this.reconcile(result, signal);
        await this.waitForPipelineOrPoll(signal);
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      this.externalAbortCleanup?.();
      this.externalAbortCleanup = void 0;
      await this.active?.pipeline.close();
    }
  }
  async poll(signal) {
    const input = {
      companyId: this.config.companyId,
      userId: this.config.userId,
      workerId: this.workerId
    };
    return this.backend.poll(input, signal);
  }
  reconcile(result, _signal) {
    const session = result.capture;
    const active = this.active;
    if (!session) {
      if (active) {
        const shutdown = active.stopping ? active.pipeline.stop() : active.pipeline.close();
        void shutdown.catch(() => void 0);
      }
      return;
    }
    if (active && !sameSession(active.session, session)) return;
    if (!active && session.desiredMode !== "running") return;
    if (!active) {
      const dependencies = this.pipelineDependenciesFactory();
      const pipeline = this.createPipeline(this.config, session, {
        ...dependencies,
        backend: dependencies.backend ?? this.backend
      });
      const run = pipeline.run();
      const done = run.then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error })
      );
      this.active = { session, pipeline, done, stopping: false };
    }
    const current = this.active;
    if (!current) return;
    if (session.desiredMode === "stopped") {
      current.stopping = true;
      void current.pipeline.stop().catch(() => {
        current.stopping = false;
      });
    } else if (session.desiredMode === "paused") {
      void current.pipeline.close().catch(() => void 0);
    }
  }
  async waitForPipelineOrPoll(signal) {
    const active = this.active;
    if (!active) {
      await this.sleep(this.pollIntervalMs, signal);
      return;
    }
    const winner = await Promise.race([active.done, this.sleep(this.pollIntervalMs, signal)]);
    if (winner === void 0) return;
    this.active = void 0;
    if (!winner.ok) throw winner.error;
  }
};

// src/main.ts
function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ event, ...fields, observedAt: (/* @__PURE__ */ new Date()).toISOString() })}
`
  );
}
async function main() {
  const config = loadCallWorkerConfig();
  const runtime = config.captureEnabled ? new CallWorkerRuntime(config) : void 0;
  const { promise: stopped, resolve: stop } = Promise.withResolvers();
  let closing;
  const shutdown = (signal) => {
    if (closing) return;
    log("call_worker_stopping", { signal });
    closing = (runtime ? runtime.close() : Promise.resolve()).finally(stop);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  log("call_worker_ready", {
    captureEnabled: config.captureEnabled,
    state: config.captureEnabled ? "idle" : "disabled",
    controlPlane: config.captureEnabled ? "polling" : "disabled",
    systemAudioEnabled: config.systemAudioEnabled
  });
  const heartbeat = setInterval(() => {
    log("call_worker_heartbeat", { captureEnabled: config.captureEnabled });
  }, 3e4);
  try {
    if (runtime) {
      await Promise.race([stopped, runtime.run()]);
    } else {
      await stopped;
    }
  } finally {
    clearInterval(heartbeat);
    if (closing) await closing;
    else if (runtime) await runtime.close();
  }
  log("call_worker_stopped", { captureEnabled: config.captureEnabled });
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown call worker failure";
  log("call_worker_failed", { message });
  process.exitCode = 1;
});
