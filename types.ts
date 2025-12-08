export enum MeetingState {
  LOBBY = 'LOBBY',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ENDED = 'ENDED',
  ERROR = 'ERROR'
}

export interface AudioVisualizerData {
  volume: number; // 0 to 1
}

export interface TranscriptionItem {
  id: string;
  text: string;
  sender: 'user' | 'model';
  isFinal: boolean;
}

// Add trace to global window object
declare global {
  interface Window {
    trace: (msg: string) => void;
  }
}