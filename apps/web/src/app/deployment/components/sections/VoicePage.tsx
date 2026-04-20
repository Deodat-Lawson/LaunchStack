'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Mic, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, InfoBox } from '../ui';

export const VoicePage: React.FC<DeploymentProps> = ({ 
  darkMode, 
  copyToClipboard, 
  copiedCode 
}) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-pink-900/50 text-pink-300' : 'bg-pink-100 text-pink-700'} rounded-full font-medium mb-6 text-sm`}>
          <Mic className="w-4 h-4" />
          Optional Feature
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Voice & Audio Integration
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Text-to-speech and voice capabilities with ElevenLabs.
        </p>
      </motion.div>

      <Section title="What is ElevenLabs?" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          ElevenLabs provides realistic AI voice generation:
        </p>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Convert document summaries to audio</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Voice-enabled AI responses</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Accessibility features for visually impaired users</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Multiple voice options and languages</span>
          </li>
        </ul>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create ElevenLabs Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                elevenlabs.io <ExternalLink className="w-4 h-4" />
              </a> and create an account.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Get API Key
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Navigate to Profile → API Keys and generate a new key.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Choose Voice
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Browse available voices in the Voice Lab and copy the Voice ID you want to use.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 4: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`ELEVENLABS_API_KEY=sk_your_key_here
ELEVENLABS_VOICE_ID=your_chosen_voice_id`}
              onCopy={() => copyToClipboard('ELEVENLABS_API_KEY=sk_your_key_here\nELEVENLABS_VOICE_ID=your_chosen_voice_id', 'elevenlabs-env')}
              copied={copiedCode === 'elevenlabs-env'}
              darkMode={darkMode}
            />
          </div>

          <InfoBox
            title="Voice ID Options"
            icon={<Mic className="w-6 h-6" />}
            darkMode={darkMode}
          >
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              Popular voice options include:
            </p>
            <ul className={`mt-2 space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
              <li>• Rachel (Female, American)</li>
              <li>• Adam (Male, American)</li>
              <li>• Antoni (Male, British)</li>
              <li>• Browse more in ElevenLabs Voice Lab</li>
            </ul>
          </InfoBox>
        </div>
      </Section>
    </>
  );
};

