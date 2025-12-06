export type PersonalAudioMode = "params" | "sequencer" | "both";

export const PERSONAL_AUDIO_MODE: PersonalAudioMode =
  (process.env.NEXT_PUBLIC_PERSONAL_AUDIO_MODE as PersonalAudioMode) ||
  "params";
