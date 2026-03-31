export interface ClassDoc {
  id: string;
  name: string;
  teacherId: string;
  schoolId: string;
  studentIds: string[];
  gridConfig: { rows: number; cols: number };
  deskPositions: Record<string, { col: number; row: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherDoc {
  uid: string;
  displayName: string;
  email: string;
  schoolId: string;
  classIds: string[];
  theme: 'dark' | 'light';
  createdAt: string;
}

export interface ClassGoalDoc {
  classId: string;
  teacherId: string;
  topics: Array<{ leitidee: string; thema: string; unterthema: string }>;
  examDate: string | null;
  setAt: string;
}

export interface StudentSummary {
  uid: string;
  displayName: string;
  email: string;
  lastActive: string | null;
  accuracy7d: number;       // 0–100 percentage
  streak: number;
  totalXp: number;
  status: 'active' | 'idle' | 'struggling' | 'offline';
  currentTopic: string | null;
  sessionProgress: { answered: number; total: number } | null;
}

export interface TopicAccuracy {
  leitidee: string;
  thema: string;
  unterthema: string;
  correct: number;
  incorrect: number;
  accuracyPct: number;
  isWissensluecke: boolean;   // accuracyPct < 60
}

export interface FeedEntry {
  userId: string;
  displayName: string;
  questionText: string;
  studentAnswer: string;
  isCorrect: boolean;
  feedback: string;
  hintsUsed: number;
  timeSpentSeconds: number;
  timestamp: number;          // Unix timestamp (int) as stored by student app
  leitidee: string;
  thema: string;
  unterthema: string;
}

export interface AnalyticsSummary {
  questionsToday: number;
  questionsThisWeek: number;
  classAverageAccuracy: number;
  avgDailyStreak: number;
  activeStudentsToday: number;
}
