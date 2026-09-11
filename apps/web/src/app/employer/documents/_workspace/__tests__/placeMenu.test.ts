import { placeMenu, placeSubmenu } from "../placeMenu";

describe("placeMenu", () => {
    it("keeps the click point when the menu fits", () => {
        expect(
            placeMenu({
                x: 40,
                y: 80,
                width: 200,
                height: 240,
                viewportWidth: 1280,
                viewportHeight: 800,
            })
        ).toEqual({ left: 40, top: 80 });
    });

    it("flips left and up when the menu would overflow the viewport", () => {
        expect(
            placeMenu({
                x: 1200,
                y: 760,
                width: 200,
                height: 240,
                viewportWidth: 1280,
                viewportHeight: 800,
            })
        ).toEqual({ left: 1072, top: 552 });
    });

    it("never places the menu past the padded origin", () => {
        expect(
            placeMenu({
                x: -40,
                y: -20,
                width: 200,
                height: 100,
                viewportWidth: 400,
                viewportHeight: 300,
            })
        ).toEqual({ left: 8, top: 8 });
    });
});

describe("placeSubmenu", () => {
    it("opens to the right of the parent when there is room", () => {
        expect(
            placeSubmenu({
                parentLeft: 100,
                parentTop: 100,
                parentWidth: 200,
                itemOffsetTop: 40,
                width: 196,
                height: 160,
                viewportWidth: 1280,
                viewportHeight: 800,
            })
        ).toEqual({ left: 296, top: 140 });
    });

    it("opens to the left when the right side would overflow", () => {
        expect(
            placeSubmenu({
                parentLeft: 1100,
                parentTop: 100,
                parentWidth: 200,
                itemOffsetTop: 0,
                width: 196,
                height: 160,
                viewportWidth: 1280,
                viewportHeight: 800,
            })
        ).toEqual({ left: 908, top: 100 });
    });
});
