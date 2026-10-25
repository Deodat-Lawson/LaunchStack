/**
 * The Simplified Chinese catalogue.
 * One import per namespace; see ../../README.md before adding one.
 */

import type { Messages } from "../../messages";

import common from "./common.json";
import language from "./language.json";
import errors from "./errors.json";
import auth from "./auth.json";
import onboarding from "./onboarding.json";
import chrome from "./chrome.json";
import sources from "./sources.json";
import chat from "./chat.json";
import workspace from "./workspace.json";
import shortcuts from "./shortcuts.json";
import settings from "./settings.json";
import companyProfile from "./companyProfile.json";
import collab from "./collab.json";
import team from "./team.json";
import agents from "./agents.json";
import mindmap from "./mindmap.json";
import viewers from "./viewers.json";
import upload from "./upload.json";
import statistics from "./statistics.json";
import generator from "./generator.json";
import growth from "./growth.json";
import vantage from "./vantage.json";
import scenarios from "./scenarios.json";
import proposals from "./proposals.json";
import tools from "./tools.json";
import notes from "./notes.json";

const messages = {
    common,
    language,
    errors,
    auth,
    onboarding,
    chrome,
    sources,
    chat,
    workspace,
    shortcuts,
    settings,
    companyProfile,
    collab,
    team,
    agents,
    mindmap,
    viewers,
    upload,
    statistics,
    generator,
    growth,
    vantage,
    scenarios,
    proposals,
    tools,
    notes,
} satisfies Messages;

export default messages;
