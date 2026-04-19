# Voice Onboarding API Documentation

## 1) Start Onboarding

### Request

`GET /api/onboard/start?user_name=Madhav`

### Response

```json
{
  "audio_base64": "<mp3-base64>"
}
```

## 2) Respond with User Audio

### Request

`POST /api/onboard/respond`

Body:

```json
{
  "user_id": "user_123",
  "audio_base64": "<webm-opus-base64>"
}
```

Audio requirements for STT:
- Encoding: `WEBM_OPUS`
- Sample rate: `48000`
- Language: `en-US`

### Success Response

```json
{
  "success": true,
  "ack_audio_base64": "<mp3-base64>",
  "success_audio_base64": "<mp3-base64>",
  "profile": {
    "skills": ["react", "customer support"],
    "experience": "2 years in support and web projects",
    "interests": ["remote work", "design"],
    "work_type": "remote",
    "level": "intermediate"
  }
}
```

### Transcription Failure Response

```json
{
  "success": false,
  "message": "transcription_failed"
}
```

## curl Examples

### Start

```bash
curl "http://localhost:3000/api/onboard/start?user_name=Madhav"
```

### Respond

```bash
curl -X POST "http://localhost:3000/api/onboard/respond" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "user_123",
    "audio_base64": "REPLACE_WITH_BASE64"
  }'
```

## Notes

- LLM extraction uses exactly one Gemini call.
- Save is an upsert into `user_profiles` by `user_id`.
- Orchestration order is fixed:
  STT → LLM → SAVE → TTS.
