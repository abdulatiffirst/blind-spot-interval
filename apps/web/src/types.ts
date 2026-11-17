export type Topic = {
  id: string;
  title: string;
  tags: string[];
  initial_knowledge: number | null;
  importance: number | null;
  duration: number;
  target_retention: number;
  status: string;
  materials: { text: string }[];
  schedule: Review | null;
  memory?: any;
};
export type Review = {
  id: string;
  topic_id: string;
  title: string;
  scheduled_at: string | null;
  ideal_due_at: string;
  mode: string;
  adjustment_reason: string | null;
  duration: number;
};
