export {
    APP_TARGET_KIND,
    LINK_TARGET_KIND,
    SELECTION_TARGET_KIND,
    type ActionDefinition,
    type ActionLabel,
    type ContextMenuEvent,
    type ContextTarget,
    type LinkInfo,
    type MenuOpenContext,
    type MenuVia,
    type TextSelectionInfo,
} from "./types";
export {
    TARGET_ATTR,
    clearTarget,
    getTarget,
    resetTargetsForTests,
    setTarget,
    targetChainFor,
    type TargetChain,
} from "./targets";
export { getAction, listActions, registerActions, resetActionsForTests } from "./registry";
export { actionItems, resolveMenu, toItem } from "./resolve";
export { isEditableElement, linkAt, textSelectionAt } from "./dom";
export { copyText, readClipboardText } from "./clipboard";
export { recordedContextMenuEvents, trackContextMenuEvent } from "./telemetry";
