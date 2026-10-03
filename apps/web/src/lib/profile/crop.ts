/**
 * Square-crop geometry for the profile photo dialog. Pure, so the dialog is
 * just pointer events and a canvas draw.
 *
 * The image sits in a square viewport of `viewport` px. At zoom 1 it
 * *covers* the viewport (short edge fits); zoom multiplies that. The offset
 * is the image centre's displacement from the viewport centre, in viewport
 * px, and is always clamped so the image covers the viewport — the crop can
 * never include empty space.
 */

export const CROP_MAX_ZOOM = 4;

export interface CropState {
    zoom: number;
    offsetX: number;
    offsetY: number;
}

export interface ImageSize {
    width: number;
    height: number;
}

export const INITIAL_CROP: CropState = { zoom: 1, offsetX: 0, offsetY: 0 };

/** Viewport px per image px at the given zoom. */
export function cropScale(image: ImageSize, viewport: number, zoom: number): number {
    return (viewport / Math.min(image.width, image.height)) * zoom;
}

export function clampCrop(state: CropState, image: ImageSize, viewport: number): CropState {
    const zoom = Math.min(CROP_MAX_ZOOM, Math.max(1, state.zoom));
    const scale = cropScale(image, viewport, zoom);
    const slackX = Math.max(0, (image.width * scale - viewport) / 2);
    const slackY = Math.max(0, (image.height * scale - viewport) / 2);
    return {
        zoom,
        offsetX: Math.min(slackX, Math.max(-slackX, state.offsetX)),
        offsetY: Math.min(slackY, Math.max(-slackY, state.offsetY)),
    };
}

/**
 * Zoom about the viewport centre: the point under the centre stays put, so
 * the offset scales with the zoom ratio before clamping.
 */
export function zoomCrop(
    state: CropState,
    nextZoom: number,
    image: ImageSize,
    viewport: number
): CropState {
    const ratio = Math.min(CROP_MAX_ZOOM, Math.max(1, nextZoom)) / state.zoom;
    return clampCrop(
        { zoom: nextZoom, offsetX: state.offsetX * ratio, offsetY: state.offsetY * ratio },
        image,
        viewport
    );
}

/** Where the image is drawn inside the viewport, for the preview's CSS. */
export function cropLayout(state: CropState, image: ImageSize, viewport: number) {
    const scale = cropScale(image, viewport, state.zoom);
    const width = image.width * scale;
    const height = image.height * scale;
    return {
        width,
        height,
        left: (viewport - width) / 2 + state.offsetX,
        top: (viewport - height) / 2 + state.offsetY,
    };
}

/** The square of the source image the viewport shows, in image px. */
export function cropSourceRect(state: CropState, image: ImageSize, viewport: number) {
    const clamped = clampCrop(state, image, viewport);
    const scale = cropScale(image, viewport, clamped.zoom);
    const { left, top } = cropLayout(clamped, image, viewport);
    const size = Math.min(viewport / scale, image.width, image.height);
    return {
        x: Math.min(image.width - size, Math.max(0, -left / scale)),
        y: Math.min(image.height - size, Math.max(0, -top / scale)),
        size,
    };
}
