/**
 * The folder and upload sentences the server words for a screen: Chinese for
 * a Chinese reader, the English unchanged for everyone else (API readers,
 * logs, tests).
 */

import { FolderError } from "~/server/folders";
import { describeFolderPathProblem, folderErrorText } from "~/server/folders/words";
import { UploadAuthorizationError } from "~/server/services/upload-authorization-error";
import { wordOr } from "~/i18n/translate";

const chinese = new Request("http://localhost/api/mindmaps", {
    headers: { cookie: "ls-locale=zh-CN.1" },
});
const english = new Request("http://localhost/api/mindmaps");

describe("folder sentences", () => {
    it("word a bad folder path in the reader's language", () => {
        expect(describeFolderPathProblem("Unfiled/Plans", chinese)).toBe(
            "不能在“Unfiled”下新建文件夹。"
        );
        expect(describeFolderPathProblem("Unfiled/Plans", english)).toBe(
            'Folders can\'t be nested under "Unfiled".'
        );
        expect(describeFolderPathProblem("Unfiled/Plans")).toBe(
            'Folders can\'t be nested under "Unfiled".'
        );
        expect(describeFolderPathProblem("Contracts", chinese)).toBeNull();
    });

    it("keep a FolderError's English as its message and word its key", () => {
        const error = new FolderError("folder_cycle", 400, { key: "sources.server.folders.cycle" });
        expect(error.message).toBe("A folder can't be moved into itself.");
        expect(folderErrorText(error, "zh-CN")).toBe("不能把文件夹移到它自身之中。");
        expect(folderErrorText(error, "en")).toBe("A folder can't be moved into itself.");
    });

    it("word a FolderError thrown as an English string when the catalogue has it", () => {
        const named = new FolderError(
            "folder_exists",
            409,
            "That name is already used. Try another."
        );
        expect(folderErrorText(named, "zh-CN")).toBe("这个名称已被使用，请换一个。");
        const unknown = new FolderError("other", 400, "Something no catalogue knows.");
        expect(folderErrorText(unknown, "zh-CN")).toBe("Something no catalogue knows.");
    });
});

describe("UploadAuthorizationError", () => {
    it("carries its English as the message and its key for the route", () => {
        const error = new UploadAuthorizationError(
            { key: "upload.server.errors.fileNotInWorkspace" },
            404
        );
        expect(error.message).toBe("File not found in this workspace");
        expect(error.status).toBe(404);
        expect(wordOr(error.copy, error.message, "zh-CN")).toBe("此工作区中未找到该文件");
    });

    it("still takes a plain sentence", () => {
        const error = new UploadAuthorizationError("Nope");
        expect(error.copy).toBeNull();
        expect(error.status).toBe(403);
        expect(wordOr(error.copy, error.message, "zh-CN")).toBe("Nope");
    });
});
