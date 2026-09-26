/**
 * The height of every top bar in the workspace centre — the chat's, a
 * Studio app's, a document's.
 *
 * Columns sit side by side, so their header rules have to meet in one line
 * across the screen. Left to their content, the chat's came out at 57px and
 * a document's at 62.5px, and the rule stepped down where one column met the
 * next. A fixed height, sized for a title over a one-line subtitle beside
 * 30px controls, is what keeps them level.
 */
export const WORKSPACE_HEADER_HEIGHT_PX = 57;
