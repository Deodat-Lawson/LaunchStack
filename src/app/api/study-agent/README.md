# Study Agent Voice API

Voice integration for the Study Agent using ElevenLabs for text-to-speech.

## Setup

### 1. Get ElevenLabs API Key

1. Sign up at [ElevenLabs](https://elevenlabs.io/)
2. Navigate to your profile settings
3. Copy your API key

### 2. Configure Environment Variables

Add the following to your `.env` file:

```env
ELEVENLABS_API_KEY=your_api_key_here
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Optional: Default voice ID (Rachel)
```

### 3. Available Voices

You can get a list of available voices by calling:
```
GET /api/study-agent/voice?action=voices
```

Or visit the [ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library) to browse voices.

## API Endpoints

### POST /api/study-agent/voice

Convert text to speech using ElevenLabs.

**Request Body:**
```json
{
  "text": "Hello! I'm your AI study buddy.",
  "voiceId": "21m00Tcm4TlvDq8ikWAM",  // Optional
  "modelId": "eleven_turbo_v2_5",     // Optional, default: "eleven_turbo_v2_5"
  "stability": 0.5,                    // Optional, 0.0-1.0
  "similarityBoost": 0.75,             // Optional, 0.0-1.0
  "style": 0.0,                        // Optional, 0.0-1.0
  "useSpeakerBoost": true              // Optional
}
```

**Response:**
- Content-Type: `audio/mpeg`
- Body: MP3 audio file

**Example:**
```typescript
const response = await fetch("/api/study-agent/voice", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    text: "Hello! How can I help you study today?",
  }),
});

const audioBlob = await response.blob();
const audioUrl = URL.createObjectURL(audioBlob);
const audio = new Audio(audioUrl);
await audio.play();
```

### GET /api/study-agent/voice?action=voices

Get list of available voices from ElevenLabs.

**Response:**
```json
{
  "voices": [
    {
      "voice_id": "21m00Tcm4TlvDq8ikWAM",
      "name": "Rachel",
      "category": "premade",
      ...
    }
  ]
}
```

## Features

### Text-to-Speech
- Real-time voice synthesis using ElevenLabs
- Natural-sounding AI voices
- Configurable voice settings (stability, similarity, style)
- Fast model (`eleven_turbo_v2_5`) for low latency

### Speech-to-Text
- Uses browser's built-in Web Speech API
- Real-time transcription
- Supports continuous recognition
- Automatic message sending when speech ends

## Usage in Components

The `VoiceChat` component automatically:
1. Records user speech using Web Speech API
2. Sends transcribed text to the message handler
3. Plays AI responses using ElevenLabs text-to-speech

### Example Integration

```tsx
import { VoiceChat } from "./VoiceChat";

function StudyBuddyPanel({ messages, onSendMessage }) {
  return (
    <VoiceChat 
      messages={messages} 
      onSendMessage={onSendMessage}
      isBuddy={true}
    />
  );
}
```

## Browser Compatibility

### Speech Recognition (Speech-to-Text)
- Chrome/Edge: ✅ Full support
- Safari: ✅ Full support (webkit prefix)
- Firefox: ❌ Not supported

### Text-to-Speech
- All modern browsers: ✅ Supported via API

## Troubleshooting

### Microphone Not Working
- Ensure browser permissions are granted
- Check browser console for errors
- Verify HTTPS (required for microphone access)

### Audio Not Playing
- Check browser audio permissions
- Verify `ELEVENLABS_API_KEY` is set correctly
- Check network tab for API errors
- Ensure audio is not muted

### API Errors
- Verify your ElevenLabs API key is valid
- Check your ElevenLabs account quota
- Ensure you have sufficient credits

## Cost Considerations

ElevenLabs pricing:
- Free tier: 10,000 characters/month
- Paid plans: Based on character usage

Monitor usage in your ElevenLabs dashboard.
