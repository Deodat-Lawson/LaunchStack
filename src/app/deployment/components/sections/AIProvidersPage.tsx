'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  ShieldAlert,
  Terminal,
  Cpu,
  Key,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step } from '../ui';

interface StepCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  darkMode: boolean;
}

const StepCard: React.FC<StepCardProps> = ({ icon, title, children, darkMode }) => (
  <div
    className={`flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 ${
      darkMode
        ? 'bg-gray-800/60 border-gray-700/60 hover:border-purple-500/40'
        : 'bg-white border-gray-200 hover:border-purple-300 hover:shadow-md'
    }`}
  >
    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <h3 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
      <div className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{children}</div>
    </div>
  </div>
);

interface CalloutProps {
  icon: React.ReactNode;
  darkMode: boolean;
  variant?: 'info' | 'warning';
  children: React.ReactNode;
}

const Callout: React.FC<CalloutProps> = ({ icon, darkMode, variant = 'info', children }) => {
  const colors = {
    info: darkMode
      ? 'bg-purple-900/20 border-purple-800/50 text-purple-300'
      : 'bg-purple-50 border-purple-200 text-purple-800',
    warning: darkMode
      ? 'bg-yellow-900/20 border-yellow-800/50 text-yellow-300'
      : 'bg-yellow-50 border-yellow-200 text-yellow-800',
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border text-sm leading-relaxed ${colors[variant]}`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>{children}</div>
    </div>
  );
};

const Divider: React.FC<{ darkMode: boolean }> = ({ darkMode }) => (
  <hr className={`my-12 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`} />
);

const Code: React.FC<{ darkMode: boolean; children: React.ReactNode }> = ({ darkMode, children }) => (
  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>{children}</code>
);

const ProviderBadge: React.FC<{ label: string; required?: boolean; darkMode: boolean }> = ({ label, required, darkMode }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${
    required
      ? darkMode
        ? 'bg-purple-900/30 border-purple-700 text-purple-300'
        : 'bg-purple-50 border-purple-200 text-purple-700'
      : darkMode
        ? 'bg-gray-800 border-gray-700 text-gray-400'
        : 'bg-gray-100 border-gray-200 text-gray-500'
  }`}>
    {label}
  </span>
);

export const AIProvidersPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  const allKeysEnvBlock = `# === AI Model Providers ===

# OpenAI (required — used for embeddings + GPT-5 chat models)
OPENAI_API_KEY=sk-proj-xxx

# Anthropic (optional — enables Claude models)
ANTHROPIC_API_KEY=sk-ant-xxx

# Google AI (optional — enables Gemini models)
GOOGLE_AI_API_KEY=AIzaSy-xxx

# Ollama (optional — enables local open-source models)
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="llama3.1:8b"`;

  const dockerOllamaBlock = `# When using Docker Compose, point to the host machine
OLLAMA_BASE_URL="http://host.docker.internal:11434"`;

  return (
    <>
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          AI Model Providers
        </h1>
        <p className={`text-xl leading-relaxed max-w-2xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Launchstack supports multiple LLM providers simultaneously. Users can switch providers and models from the UI at query time.
        </p>
      </motion.div>

      <Callout icon={<AlertTriangle className="w-5 h-5" />} darkMode={darkMode} variant="warning">
        <strong>OpenAI is currently required</strong> even if you only plan to use other providers for chat.
        The embedding pipeline (<Code darkMode={darkMode}>text-embedding-3-large</Code>) used for document ingestion and
        RAG search depends on the OpenAI API. See the <strong>Embeddings</strong> section below for details and future alternatives.
      </Callout>

      <Divider darkMode={darkMode} />

      {/* ── Provider overview ── */}
      <Section title="Supported providers" subtitle="Configure one or more providers to enable their models." darkMode={darkMode}>
        <div className={`overflow-hidden rounded-xl border ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={darkMode ? 'bg-gray-800/80' : 'bg-gray-50'}>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Provider</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Models</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Env Variable</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Status</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${darkMode ? 'divide-gray-700/60' : 'divide-gray-200'}`}>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>OpenAI</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>GPT-5.2, GPT-5.1, GPT-5 Mini, GPT-5 Nano</td>
                <td className={`px-4 py-3 font-mono text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>OPENAI_API_KEY</td>
                <td className="px-4 py-3"><ProviderBadge label="Required" required darkMode={darkMode} /></td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Anthropic</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Claude Sonnet 4, Claude Opus 4.5</td>
                <td className={`px-4 py-3 font-mono text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>ANTHROPIC_API_KEY</td>
                <td className="px-4 py-3"><ProviderBadge label="Optional" darkMode={darkMode} /></td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Google</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Gemini 2.5 Flash, Gemini 3 Flash, Gemini 3 Pro</td>
                <td className={`px-4 py-3 font-mono text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>GOOGLE_AI_API_KEY</td>
                <td className="px-4 py-3"><ProviderBadge label="Optional" darkMode={darkMode} /></td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Ollama</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Llama 3.1, Mistral, CodeLlama, Gemma 2, Phi-3, Qwen 2.5</td>
                <td className={`px-4 py-3 font-mono text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>OLLAMA_BASE_URL</td>
                <td className="px-4 py-3"><ProviderBadge label="Optional" darkMode={darkMode} /></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={`mt-3 text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          Only providers with configured API keys appear in the UI. Users select a provider and model per query.
        </p>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Quick setup ── */}
      <Section title="Configuration" subtitle="Add provider API keys to your .env file." darkMode={darkMode}>
        <div className="space-y-6">
          <Step
            number={1}
            title="Add API keys to .env"
            code={allKeysEnvBlock}
            onCopy={() => copyToClipboard(allKeysEnvBlock, 'ai-1')}
            copied={copiedCode === 'ai-1'}
            darkMode={darkMode}
          >
            <p>Only <Code darkMode={darkMode}>OPENAI_API_KEY</Code> is required. Add other keys to enable those providers.</p>
          </Step>

          <Step
            number={2}
            title="Get your API keys"
            darkMode={darkMode}
            onCopy={() => {/* no-op */}}
            copied={false}
          >
            <div className="space-y-2 mt-1">
              {[
                { name: 'OpenAI', url: 'https://platform.openai.com/api-keys' },
                { name: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
                { name: 'Google AI', url: 'https://aistudio.google.com/apikey' },
                { name: 'Ollama', url: 'https://ollama.com/download', note: 'No API key needed — install locally' },
              ].map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                  <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{p.name}:</span>
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-600 dark:text-purple-400 hover:underline text-sm"
                  >
                    {p.url.replace('https://', '')}
                  </a>
                  {p.note && (
                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>({p.note})</span>
                  )}
                </div>
              ))}
            </div>
          </Step>

          <Step
            number={3}
            title="Restart the app"
            description="After updating .env, restart Next.js (or re-run Docker Compose) for the changes to take effect."
            code="pnpm dev"
            onCopy={() => copyToClipboard('pnpm dev', 'ai-3')}
            copied={copiedCode === 'ai-3'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── OpenAI (required) ── */}
      <Section title="OpenAI" subtitle="Required provider — powers both chat models and the embedding pipeline." darkMode={darkMode}>
        <div className="space-y-4">
          <StepCard icon={<Key className="w-5 h-5" />} title="Why is OpenAI required?" darkMode={darkMode}>
            Launchstack uses OpenAI&apos;s <Code darkMode={darkMode}>text-embedding-3-large</Code> model for all document embeddings
            (1536 dimensions). These embeddings power the RAG search pipeline, ensemble retrieval, document matching, and
            predictive document analysis. Without an OpenAI key, documents cannot be ingested or searched.
          </StepCard>
          <StepCard icon={<Cpu className="w-5 h-5" />} title="Available chat models" darkMode={darkMode}>
            <span className="flex flex-wrap gap-1.5 mt-1">
              {['GPT-5.2', 'GPT-5.1', 'GPT-5 Mini', 'GPT-5 Nano'].map((m) => (
                <Code key={m} darkMode={darkMode}>{m}</Code>
              ))}
            </span>
          </StepCard>
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Anthropic ── */}
      <Section title="Anthropic (Claude)" subtitle="Optional — add ANTHROPIC_API_KEY to enable Claude models." darkMode={darkMode}>
        <StepCard icon={<Key className="w-5 h-5" />} title="Available chat models" darkMode={darkMode}>
          <span className="flex flex-wrap gap-1.5 mt-1">
            {['Claude Sonnet 4', 'Claude Opus 4.5'].map((m) => (
              <Code key={m} darkMode={darkMode}>{m}</Code>
            ))}
          </span>
          <p className="mt-2">
            Get an API key from{' '}
            <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">
              console.anthropic.com
            </a>
          </p>
        </StepCard>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Google ── */}
      <Section title="Google (Gemini)" subtitle="Optional — add GOOGLE_AI_API_KEY to enable Gemini models." darkMode={darkMode}>
        <StepCard icon={<Key className="w-5 h-5" />} title="Available chat models" darkMode={darkMode}>
          <span className="flex flex-wrap gap-1.5 mt-1">
            {['Gemini 2.5 Flash', 'Gemini 3 Flash', 'Gemini 3 Pro'].map((m) => (
              <Code key={m} darkMode={darkMode}>{m}</Code>
            ))}
          </span>
          <p className="mt-2">
            Get an API key from{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-purple-600 dark:text-purple-400 hover:underline">
              aistudio.google.com
            </a>
          </p>
        </StepCard>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Ollama ── */}
      <Section title="Ollama (Local Models)" subtitle="Optional — run open-source models locally without API costs." darkMode={darkMode}>
        <div className="space-y-4">
          <StepCard icon={<Cpu className="w-5 h-5" />} title="Why use Ollama?" darkMode={darkMode}>
            Models run entirely on your hardware. No data leaves your network — perfect for sensitive documents. Free and open-source with no per-token costs.
          </StepCard>

          <div className={`overflow-hidden rounded-xl border ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className={darkMode ? 'bg-gray-800/80' : 'bg-gray-50'}>
                  <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Model</th>
                  <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Size</th>
                  <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Notes</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${darkMode ? 'divide-gray-700/60' : 'divide-gray-200'}`}>
                {[
                  { model: 'llama3.1:8b', size: '~4.7 GB', note: 'Default. Good balance of speed and quality.' },
                  { model: 'llama3.2:3b', size: '~2.0 GB', note: 'Lightweight, fast. Great for low-resource machines.' },
                  { model: 'mistral:7b', size: '~4.1 GB', note: 'Strong general-purpose model from Mistral AI.' },
                  { model: 'codellama:7b', size: '~3.8 GB', note: 'Optimized for code understanding and generation.' },
                  { model: 'gemma2:9b', size: '~5.4 GB', note: 'Google\'s open model. Strong reasoning capabilities.' },
                  { model: 'phi3:mini', size: '~2.3 GB', note: 'Microsoft\'s compact model. Fast with solid quality.' },
                  { model: 'qwen2.5:7b', size: '~4.4 GB', note: 'Alibaba\'s model. Strong multilingual support.' },
                ].map((row) => (
                  <tr key={row.model} className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                    <td className={`px-4 py-3 font-mono text-sm ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{row.model}</td>
                    <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{row.size}</td>
                    <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6 mt-8">
          <Step
            number={1}
            title="Install Ollama"
            description="Download and install from ollama.com, or use a package manager."
            code={`# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download the installer from https://ollama.com/download`}
            onCopy={() => copyToClipboard('curl -fsSL https://ollama.com/install.sh | sh', 'ollama-1')}
            copied={copiedCode === 'ollama-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Pull a model"
            description="Download the model(s) you want. This only needs to be done once per model."
            code={`ollama pull llama3.1:8b
# Or try other models:
# ollama pull mistral:7b
# ollama pull codellama:7b
# ollama pull gemma2:9b`}
            onCopy={() => copyToClipboard('ollama pull llama3.1:8b', 'ollama-2')}
            copied={copiedCode === 'ollama-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Start the Ollama server"
            description="The server runs on port 11434 by default."
            code="ollama serve"
            onCopy={() => copyToClipboard('ollama serve', 'ollama-3')}
            copied={copiedCode === 'ollama-3'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Verify"
            code={`curl http://localhost:11434/api/tags
# Should return a JSON list of your pulled models`}
            onCopy={() => copyToClipboard('curl http://localhost:11434/api/tags', 'ollama-4')}
            copied={copiedCode === 'ollama-4'}
            darkMode={darkMode}
          />
        </div>

        <div className="mt-6">
          <Callout icon={<Terminal className="w-5 h-5" />} darkMode={darkMode}>
            <strong>Docker users:</strong> Ollama runs on the host machine (needs direct GPU/CPU access).
            Use <Code darkMode={darkMode}>OLLAMA_BASE_URL=&quot;http://host.docker.internal:11434&quot;</Code> in
            your <Code darkMode={darkMode}>.env</Code> so the container can reach it.
            On Linux, you may also need <Code darkMode={darkMode}>extra_hosts: [&quot;host.docker.internal:host-gateway&quot;]</Code> in your compose file.
          </Callout>
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Embeddings ── */}
      <Section title="Embeddings" subtitle="How document vectorization works and how to reduce OpenAI dependency." darkMode={darkMode}>
        <div className="space-y-4">
          <StepCard icon={<AlertTriangle className="w-5 h-5" />} title="Current architecture" darkMode={darkMode}>
            All document embeddings are generated with OpenAI&apos;s <Code darkMode={darkMode}>text-embedding-3-large</Code> (1536
            dimensions). This is used during document ingestion, RAG search, ensemble retrieval, and predictive analysis.
            The <Code darkMode={darkMode}>OPENAI_API_KEY</Code> must be set for documents to be processed and searched,
            regardless of which chat provider you use.
          </StepCard>

          <StepCard icon={<Lightbulb className="w-5 h-5" />} title="Making embeddings provider-agnostic (future)" darkMode={darkMode}>
            <p className="mb-2">To fully decouple from OpenAI, the embedding pipeline would need an abstraction layer similar to the chat model factory. Possible approaches:</p>
            <ol className="list-decimal list-inside space-y-1.5 ml-1">
              <li>
                <strong>Ollama embeddings</strong> — Use <Code darkMode={darkMode}>OllamaEmbeddings</Code> from <Code darkMode={darkMode}>@langchain/ollama</Code> with
                models like <Code darkMode={darkMode}>nomic-embed-text</Code> or <Code darkMode={darkMode}>mxbai-embed-large</Code>.
                Free, local, and privacy-preserving. Dimensions would need to match the pgvector column.
              </li>
              <li>
                <strong>Google embeddings</strong> — Use <Code darkMode={darkMode}>GoogleGenerativeAIEmbeddings</Code> with
                <Code darkMode={darkMode}>text-embedding-004</Code>. Requires a Google AI API key (already configured if using Gemini).
              </li>
              <li>
                <strong>HuggingFace Inference API</strong> — Use <Code darkMode={darkMode}>HuggingFaceInferenceEmbeddings</Code> from <Code darkMode={darkMode}>@langchain/community</Code>.
                Cloud-hosted open-source models with a free tier.
              </li>
              <li>
                <strong>Local ONNX models</strong> — Run embedding models locally via the sidecar service
                (e.g. <Code darkMode={darkMode}>BAAI/bge-large-en-v1.5</Code>). Zero external API calls, but requires more compute.
              </li>
            </ol>
            <p className="mt-3">
              The key constraint is that all existing embeddings in the database must use the <strong>same model and dimensions</strong>.
              Switching embedding providers requires re-indexing all documents and updating the pgvector column dimensions.
            </p>
          </StepCard>
        </div>
      </Section>

      {/* ── Footer callouts ── */}
      <div className="space-y-4 mb-16">
        <Callout icon={<CheckCircle2 className="w-5 h-5" />} darkMode={darkMode}>
          <strong>Tip:</strong> You can enable all four providers at once. Users pick the provider per query, so you can
          compare cloud vs. local answers side-by-side.
        </Callout>

        <Callout icon={<ShieldAlert className="w-5 h-5" />} darkMode={darkMode} variant="warning">
          <strong>Performance note:</strong> Local Ollama models are slower than cloud APIs, especially without a GPU.
          For production workloads, consider a machine with at least 16 GB RAM and a CUDA-capable GPU.
        </Callout>
      </div>
    </>
  );
};
