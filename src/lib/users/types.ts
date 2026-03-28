export type HotelUserRole = "hotel_admin" | "hotel_front";

export type HotelUserRecord = {
  id: string;
  email: string;
  hotel_id: string;
  role: HotelUserRole;
  display_name: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
  disabled_at?: string;
  disabled_by?: string;
  last_sign_in_at?: string | null;
};

export type CreateStaffPayload = {
  displayName: string;
  email: string;
  password: string;
  role: Extract<HotelUserRole, "hotel_front">;
};

export type UpdateStaffStatusPayload = {
  isActive: boolean;
};
