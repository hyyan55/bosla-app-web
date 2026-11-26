export type ComplexityLevel = 'simple' | 'medium' | 'complex';

export type TransactionType = 'gift' | 'topup' | 'build_debit' | 'refund' | 'admin_credit' | 'admin_debit';

export type TopupMethod = 'bankak' | 'sahil' | 'mycashy';

export type TopupStatus = 'pending' | 'approved' | 'rejected';

export type BuildStatus = 'building' | 'ready' | 'failed';

export interface UserProfile {
  id: string;
  full_name: string;
  username: string;
  email: string;
  phone?: string;
  wallet_number: string;
  points_balance: number;
  email_verified: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface PointsTransaction {
  id: string;
  user_id: string;
  wallet_number?: string;
  user_name?: string;
  type: TransactionType;
  amount: number; // positive for credit, negative for debit
  balance_after: number;
  description: string;
  created_at: string;
}

export interface TopupRequest {
  id: string;
  user_id: string;
  wallet_number: string;
  user_name: string;
  method: TopupMethod;
  points: number;
  price_sdg: number;
  status: TopupStatus;
  admin_note?: string;
  created_at: string;
  reviewed_at?: string;
}

export interface AppBuild {
  id: string;
  user_id: string;
  description: string;
  complexity: ComplexityLevel;
  points_spent: number;
  status: BuildStatus;
  apk_url?: string | null;
  error_message?: string | null;
  branch_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppSettings {
  point_price_sdg: number;
  gift_points: number;
  admin_whatsapp: string;
}

export interface EstimatePayload {
  complexity: ComplexityLevel;
  complexityLabel: string;
  points: number;
  priceSdg: number;
  features: string[];
  reason: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  text: string;
  createdAt: string;
  estimate?: EstimatePayload;
  promptDescription?: string;
  isError?: boolean;
}

export interface AuthSession {
  user: UserProfile;
  access_token: string;
}
