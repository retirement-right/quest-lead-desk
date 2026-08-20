export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      birthday_outreach_log: {
        Row: {
          contact_id: string
          contact_name: string | null
          id: string
          notes: string | null
          outreach_type: string
          person_kind: string
          recipient: string | null
          sent_at: string
          sent_by: string | null
          year_sent: number
        }
        Insert: {
          contact_id: string
          contact_name?: string | null
          id?: string
          notes?: string | null
          outreach_type: string
          person_kind?: string
          recipient?: string | null
          sent_at?: string
          sent_by?: string | null
          year_sent: number
        }
        Update: {
          contact_id?: string
          contact_name?: string | null
          id?: string
          notes?: string | null
          outreach_type?: string
          person_kind?: string
          recipient?: string | null
          sent_at?: string
          sent_by?: string | null
          year_sent?: number
        }
        Relationships: []
      }
      bookedin_appointments: {
        Row: {
          appointment_date: string | null
          appointment_status: string
          contact_email: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          id: string
          notes: string | null
          process_error: string | null
          processed_at: string | null
          raw_payload: Json | null
        }
        Insert: {
          appointment_date?: string | null
          appointment_status: string
          contact_email: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          process_error?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
        }
        Update: {
          appointment_date?: string | null
          appointment_status?: string
          contact_email?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          process_error?: string | null
          processed_at?: string | null
          raw_payload?: Json | null
        }
        Relationships: []
      }
      contact_activity: {
        Row: {
          body: string | null
          channel: string | null
          created_at: string
          created_by: string | null
          direction: string
          error: string | null
          id: string
          lead_id: string
          message_sid: string | null
          metadata: Json | null
          provider_status: string | null
          recipient: string | null
          sender: string | null
          status: string
          to_number: string | null
          type: string
        }
        Insert: {
          body?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          error?: string | null
          id?: string
          lead_id: string
          message_sid?: string | null
          metadata?: Json | null
          provider_status?: string | null
          recipient?: string | null
          sender?: string | null
          status?: string
          to_number?: string | null
          type: string
        }
        Update: {
          body?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string
          error?: string | null
          id?: string
          lead_id?: string
          message_sid?: string | null
          metadata?: Json | null
          provider_status?: string | null
          recipient?: string | null
          sender?: string | null
          status?: string
          to_number?: string | null
          type?: string
        }
        Relationships: []
      }
      inbound_sms_unmatched: {
        Row: {
          body: string | null
          created_at: string
          from_number: string
          id: string
          message_sid: string
          metadata: Json | null
          num_media: number
          provider_status: string | null
          received_at: string
          resolved_at: string | null
          resolved_lead_id: string | null
          to_number: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          from_number: string
          id?: string
          message_sid: string
          metadata?: Json | null
          num_media?: number
          provider_status?: string | null
          received_at?: string
          resolved_at?: string | null
          resolved_lead_id?: string | null
          to_number?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          from_number?: string
          id?: string
          message_sid?: string
          metadata?: Json | null
          num_media?: number
          provider_status?: string | null
          received_at?: string
          resolved_at?: string | null
          resolved_lead_id?: string | null
          to_number?: string | null
        }
        Relationships: []
      }
      lead_documents: {
        Row: {
          file_name: string
          file_path: string
          id: string
          lead_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          file_path: string
          id?: string
          lead_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          file_path?: string
          id?: string
          lead_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
