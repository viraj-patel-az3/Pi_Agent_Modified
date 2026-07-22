/**
 * Local test harness for the new coding-agent test suite.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { registerFauxProvider } from "@earendil-works/pi-ai";
import { AgentSession } from "../../src/core/agent-session.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import { convertToLlm } from "../../src/core/messages.js";
import { ModelRegistry } from "../../src/core/model-registry.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SettingsManager } from "../../src/core/settings-manager.js";
import { createTestExtensionsResult, createTestResourceLoader, } from "../utilities.js";
export function getMessageText(message) {
    if (!message || typeof message !== "object" || !("content" in message)) {
        return "";
    }
    const content = message.content;
    if (content === undefined) {
        return "";
    }
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n");
}
export function getUserTexts(harness) {
    return harness.session.messages
        .filter((message) => message.role === "user")
        .map((message) => getMessageText(message));
}
export function getAssistantTexts(harness) {
    return harness.session.messages
        .filter((message) => message.role === "assistant")
        .map((message) => getMessageText(message));
}
function createTempDir() {
    const tempDir = join(tmpdir(), `pi-suite-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    return tempDir;
}
export async function createHarness(options = {}) {
    const tempDir = createTempDir();
    const fauxProvider = registerFauxProvider({
        models: options.models,
    });
    fauxProvider.setResponses([]);
    const model = fauxProvider.getModel();
    const toolMap = options.tools ? Object.fromEntries(options.tools.map((tool) => [tool.name, tool])) : undefined;
    const withConfiguredAuth = options.withConfiguredAuth ?? true;
    const extensionRunnerRef = {};
    //Viraj's Code Start
    const sessionManager = options.sessionManager ?? SessionManager.inMemory();
    //Viraj's Code End
    const settingsManager = SettingsManager.inMemory(options.settings);
    const authStorage = AuthStorage.inMemory();
    if (withConfiguredAuth) {
        authStorage.setRuntimeApiKey(model.provider, "faux-key");
    }
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    if (withConfiguredAuth) {
        modelRegistry.registerProvider(model.provider, {
            baseUrl: model.baseUrl,
            apiKey: "faux-key",
            api: fauxProvider.api,
            models: fauxProvider.models.map((registeredModel) => ({
                id: registeredModel.id,
                name: registeredModel.name,
                api: registeredModel.api,
                reasoning: registeredModel.reasoning,
                input: registeredModel.input,
                cost: registeredModel.cost,
                contextWindow: registeredModel.contextWindow,
                maxTokens: registeredModel.maxTokens,
                baseUrl: registeredModel.baseUrl,
            })),
        });
    }
    const agent = new Agent({
        getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
        initialState: {
            model,
            systemPrompt: options.systemPrompt ?? "You are a test assistant.",
            tools: [],
        },
        convertToLlm,
        onPayload: async (payload) => {
            const runner = extensionRunnerRef.current;
            if (!runner?.hasHandlers("before_provider_request")) {
                return payload;
            }
            return runner.emitBeforeProviderRequest(payload);
        },
        onResponse: async (response) => {
            const runner = extensionRunnerRef.current;
            if (!runner?.hasHandlers("after_provider_response")) {
                return;
            }
            await runner.emit({
                type: "after_provider_response",
                status: response.status,
                headers: response.headers,
            });
        },
        transformContext: async (messages) => {
            const runner = extensionRunnerRef.current;
            if (!runner)
                return messages;
            return runner.emitContext(messages);
        },
    });
    const extensionsResult = options.extensionFactories
        ? await createTestExtensionsResult(options.extensionFactories, tempDir)
        : undefined;
    const resourceLoader = options.resourceLoader ?? createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined);
    const session = new AgentSession({
        agent,
        sessionManager,
        settingsManager,
        cwd: tempDir,
        modelRegistry,
        resourceLoader,
        baseToolsOverride: toolMap,
        initialActiveToolNames: options.initialActiveToolNames,
        allowedToolNames: options.allowedToolNames,
        excludedToolNames: options.excludedToolNames,
        extensionRunnerRef,
    });
    const events = [];
    session.subscribe((event) => {
        events.push(event);
    });
    return {
        session,
        sessionManager,
        settingsManager,
        authStorage,
        faux: fauxProvider,
        models: fauxProvider.models,
        getModel: fauxProvider.getModel,
        setResponses: fauxProvider.setResponses,
        appendResponses: fauxProvider.appendResponses,
        getPendingResponseCount: fauxProvider.getPendingResponseCount,
        events,
        eventsOfType(type) {
            return events.filter((event) => event.type === type);
        },
        tempDir,
        cleanup() {
            session.dispose();
            fauxProvider.unregister();
            if (existsSync(tempDir)) {
                rmSync(tempDir, { recursive: true });
            }
        },
    };
}
//# sourceMappingURL=harness.js.map