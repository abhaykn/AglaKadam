export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      academic_years: {
        Row: {
          created_at: string;
          ends_on: string;
          id: string;
          label: string;
          starts_on: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_on: string;
          id?: string;
          label: string;
          starts_on: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string;
          id?: string;
          label?: string;
          starts_on?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      attendance_sessions: {
        Row: {
          absent_student_ids: string[];
          attendance_date: string;
          class_section_id: string;
          client_change_id: string | null;
          created_at: string;
          enrolled_count: number;
          id: string;
          marked_by: string | null;
          present_count: number | null;
          updated_at: string;
        };
        Insert: {
          absent_student_ids?: string[];
          attendance_date: string;
          class_section_id: string;
          client_change_id?: string | null;
          created_at?: string;
          enrolled_count?: number;
          id?: string;
          marked_by?: string | null;
          present_count?: number | null;
          updated_at?: string;
        };
        Update: {
          absent_student_ids?: string[];
          attendance_date?: string;
          class_section_id?: string;
          client_change_id?: string | null;
          created_at?: string;
          enrolled_count?: number;
          id?: string;
          marked_by?: string | null;
          present_count?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'attendance_sessions_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_sessions_marked_by_fkey';
            columns: ['marked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_events: {
        Row: {
          actor_id: string | null;
          actor_role: string;
          changes: Json;
          id: number;
          occurred_at: string;
          operation: string;
          record_id: string | null;
          table_name: string;
        };
        Insert: {
          actor_id?: string | null;
          actor_role: string;
          changes: Json;
          id?: never;
          occurred_at?: string;
          operation: string;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          actor_id?: string | null;
          actor_role?: string;
          changes?: Json;
          id?: never;
          occurred_at?: string;
          operation?: string;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      blocks: {
        Row: {
          code: string;
          created_at: string;
          district_id: string;
          id: string;
          name_en: string;
          name_hi: string | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          district_id: string;
          id?: string;
          name_en: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          district_id?: string;
          id?: string;
          name_en?: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'blocks_district_id_fkey';
            columns: ['district_id'];
            isOneToOne: false;
            referencedRelation: 'districts';
            referencedColumns: ['id'];
          },
        ];
      };
      class_notes: {
        Row: {
          attachment_bytes: number | null;
          attachment_name: string | null;
          attachment_path: string | null;
          attachment_type: string | null;
          author_id: string | null;
          author_name: string | null;
          body: string;
          class_section_id: string;
          created_at: string;
          due_on: string | null;
          id: string;
          kind: string;
          school_id: string;
        };
        Insert: {
          attachment_bytes?: number | null;
          attachment_name?: string | null;
          attachment_path?: string | null;
          attachment_type?: string | null;
          author_id?: string | null;
          author_name?: string | null;
          body: string;
          class_section_id: string;
          created_at?: string;
          due_on?: string | null;
          id: string;
          kind?: string;
          school_id: string;
        };
        Update: {
          attachment_bytes?: number | null;
          attachment_name?: string | null;
          attachment_path?: string | null;
          attachment_type?: string | null;
          author_id?: string | null;
          author_name?: string | null;
          body?: string;
          class_section_id?: string;
          created_at?: string;
          due_on?: string | null;
          id?: string;
          kind?: string;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'class_notes_author_id_fkey';
            columns: ['author_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_notes_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_notes_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      class_sections: {
        Row: {
          academic_year_id: string;
          created_at: string;
          grade: number;
          id: string;
          is_active: boolean;
          medium: string;
          school_id: string;
          section: string;
          updated_at: string;
        };
        Insert: {
          academic_year_id: string;
          created_at?: string;
          grade: number;
          id?: string;
          is_active?: boolean;
          medium?: string;
          school_id: string;
          section?: string;
          updated_at?: string;
        };
        Update: {
          academic_year_id?: string;
          created_at?: string;
          grade?: number;
          id?: string;
          is_active?: boolean;
          medium?: string;
          school_id?: string;
          section?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'class_sections_academic_year_id_fkey';
            columns: ['academic_year_id'];
            isOneToOne: false;
            referencedRelation: 'academic_years';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_sections_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      class_teachers: {
        Row: {
          class_section_id: string;
          created_at: string;
          is_primary: boolean;
          teacher_id: string;
        };
        Insert: {
          class_section_id: string;
          created_at?: string;
          is_primary?: boolean;
          teacher_id: string;
        };
        Update: {
          class_section_id?: string;
          created_at?: string;
          is_primary?: boolean;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'class_teachers_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'class_teachers_teacher_id_fkey';
            columns: ['teacher_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      clusters: {
        Row: {
          block_id: string;
          code: string;
          created_at: string;
          id: string;
          name_en: string;
          name_hi: string | null;
          updated_at: string;
        };
        Insert: {
          block_id: string;
          code: string;
          created_at?: string;
          id?: string;
          name_en: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Update: {
          block_id?: string;
          code?: string;
          created_at?: string;
          id?: string;
          name_en?: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'clusters_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'blocks';
            referencedColumns: ['id'];
          },
        ];
      };
      crp_tasks: {
        Row: {
          cluster_id: string;
          created_at: string;
          created_by: string | null;
          details: string | null;
          done_at: string | null;
          due_on: string | null;
          id: string;
          school_id: string | null;
          source: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          cluster_id: string;
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_on?: string | null;
          id: string;
          school_id?: string | null;
          source?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          cluster_id?: string;
          created_at?: string;
          created_by?: string | null;
          details?: string | null;
          done_at?: string | null;
          due_on?: string | null;
          id?: string;
          school_id?: string | null;
          source?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'crp_tasks_cluster_id_fkey';
            columns: ['cluster_id'];
            isOneToOne: false;
            referencedRelation: 'clusters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'crp_tasks_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'crp_tasks_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      districts: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name_en: string;
          name_hi: string | null;
          state_id: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name_en: string;
          name_hi?: string | null;
          state_id: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name_en?: string;
          name_hi?: string | null;
          state_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'districts_state_id_fkey';
            columns: ['state_id'];
            isOneToOne: false;
            referencedRelation: 'states';
            referencedColumns: ['id'];
          },
        ];
      };
      enrolments: {
        Row: {
          class_section_id: string;
          created_at: string;
          created_by: string | null;
          ended_on: string | null;
          enrolled_on: string;
          id: string;
          roll_number: number | null;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          class_section_id: string;
          created_at?: string;
          created_by?: string | null;
          ended_on?: string | null;
          enrolled_on?: string;
          id?: string;
          roll_number?: number | null;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          class_section_id?: string;
          created_at?: string;
          created_by?: string | null;
          ended_on?: string | null;
          enrolled_on?: string;
          id?: string;
          roll_number?: number | null;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'enrolments_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'enrolments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'enrolments_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      exam_mark_changes: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          id: number;
          new_absent: boolean | null;
          new_grade: string | null;
          new_marks: number | null;
          old_absent: boolean;
          old_grade: string | null;
          old_marks: number | null;
          paper_id: string;
          removed: boolean;
          student_id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          id?: never;
          new_absent?: boolean | null;
          new_grade?: string | null;
          new_marks?: number | null;
          old_absent: boolean;
          old_grade?: string | null;
          old_marks?: number | null;
          paper_id: string;
          removed?: boolean;
          student_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          id?: never;
          new_absent?: boolean | null;
          new_grade?: string | null;
          new_marks?: number | null;
          old_absent?: boolean;
          old_grade?: string | null;
          old_marks?: number | null;
          paper_id?: string;
          removed?: boolean;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'exam_mark_changes_changed_by_fkey';
            columns: ['changed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_mark_changes_paper_id_fkey';
            columns: ['paper_id'];
            isOneToOne: false;
            referencedRelation: 'exam_papers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_mark_changes_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      exam_marks: {
        Row: {
          absent: boolean;
          entered_at: string;
          entered_by: string | null;
          grade: string | null;
          marks: number | null;
          paper_id: string;
          student_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          absent?: boolean;
          entered_at?: string;
          entered_by?: string | null;
          grade?: string | null;
          marks?: number | null;
          paper_id: string;
          student_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          absent?: boolean;
          entered_at?: string;
          entered_by?: string | null;
          grade?: string | null;
          marks?: number | null;
          paper_id?: string;
          student_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'exam_marks_entered_by_fkey';
            columns: ['entered_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_marks_paper_id_fkey';
            columns: ['paper_id'];
            isOneToOne: false;
            referencedRelation: 'exam_papers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_marks_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_marks_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      exam_papers: {
        Row: {
          class_section_id: string;
          client_change_id: string | null;
          created_at: string;
          exam_id: string;
          held_on: string;
          id: string;
          max_marks: number | null;
          revision: number;
          scale: string;
          school_id: string;
          subject: string;
          subject_name: string | null;
          updated_at: string;
        };
        Insert: {
          class_section_id: string;
          client_change_id?: string | null;
          created_at?: string;
          exam_id: string;
          held_on: string;
          id: string;
          max_marks?: number | null;
          revision?: number;
          scale?: string;
          school_id: string;
          subject: string;
          subject_name?: string | null;
          updated_at?: string;
        };
        Update: {
          class_section_id?: string;
          client_change_id?: string | null;
          created_at?: string;
          exam_id?: string;
          held_on?: string;
          id?: string;
          max_marks?: number | null;
          revision?: number;
          scale?: string;
          school_id?: string;
          subject?: string;
          subject_name?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'exam_papers_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_papers_exam_id_fkey';
            columns: ['exam_id'];
            isOneToOne: false;
            referencedRelation: 'exams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_papers_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      exam_result_shares: {
        Row: {
          class_section_id: string;
          exam_id: string;
          school_id: string;
          shared_at: string;
          shared_by: string | null;
        };
        Insert: {
          class_section_id: string;
          exam_id: string;
          school_id: string;
          shared_at?: string;
          shared_by?: string | null;
        };
        Update: {
          class_section_id?: string;
          exam_id?: string;
          school_id?: string;
          shared_at?: string;
          shared_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'exam_result_shares_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_result_shares_exam_id_fkey';
            columns: ['exam_id'];
            isOneToOne: false;
            referencedRelation: 'exams';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_result_shares_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exam_result_shares_shared_by_fkey';
            columns: ['shared_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      exams: {
        Row: {
          academic_year_id: string;
          cluster_id: string | null;
          created_at: string;
          created_by: string | null;
          ends_on: string;
          id: string;
          kind: string;
          school_id: string | null;
          starts_on: string;
          title: string | null;
          updated_at: string;
        };
        Insert: {
          academic_year_id: string;
          cluster_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_on: string;
          id: string;
          kind: string;
          school_id?: string | null;
          starts_on: string;
          title?: string | null;
          updated_at?: string;
        };
        Update: {
          academic_year_id?: string;
          cluster_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_on?: string;
          id?: string;
          kind?: string;
          school_id?: string | null;
          starts_on?: string;
          title?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'exams_academic_year_id_fkey';
            columns: ['academic_year_id'];
            isOneToOne: false;
            referencedRelation: 'academic_years';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exams_cluster_id_fkey';
            columns: ['cluster_id'];
            isOneToOne: false;
            referencedRelation: 'clusters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exams_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'exams_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      guardian_consents: {
        Row: {
          granted: boolean;
          guardian_name: string;
          id: string;
          method: string;
          purpose: string;
          recorded_at: string;
          recorded_by: string | null;
          student_id: string;
        };
        Insert: {
          granted: boolean;
          guardian_name: string;
          id?: string;
          method: string;
          purpose: string;
          recorded_at?: string;
          recorded_by?: string | null;
          student_id: string;
        };
        Update: {
          granted?: boolean;
          guardian_name?: string;
          id?: string;
          method?: string;
          purpose?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'guardian_consents_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'guardian_consents_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      notification_settings: {
        Row: {
          check_back: boolean;
          plan_ready: boolean;
          profile_id: string;
          pulse_week: boolean;
          updated_at: string;
        };
        Insert: {
          check_back?: boolean;
          plan_ready?: boolean;
          profile_id: string;
          pulse_week?: boolean;
          updated_at?: string;
        };
        Update: {
          check_back?: boolean;
          plan_ready?: boolean;
          profile_id?: string;
          pulse_week?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notification_settings_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: true;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          account_kind: string;
          created_at: string;
          full_name: string;
          id: string;
          is_active: boolean;
          password_change_required: boolean;
          phone: string | null;
          preferred_language: string;
          updated_at: string;
        };
        Insert: {
          account_kind: string;
          created_at?: string;
          full_name: string;
          id: string;
          is_active?: boolean;
          password_change_required?: boolean;
          phone?: string | null;
          preferred_language?: string;
          updated_at?: string;
        };
        Update: {
          account_kind?: string;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          password_change_required?: boolean;
          phone?: string | null;
          preferred_language?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pulse_absences: {
        Row: {
          absent_on: string;
          created_at: string;
          marked_by: string | null;
          sample_id: string;
        };
        Insert: {
          absent_on: string;
          created_at?: string;
          marked_by?: string | null;
          sample_id: string;
        };
        Update: {
          absent_on?: string;
          created_at?: string;
          marked_by?: string | null;
          sample_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_absences_marked_by_fkey';
            columns: ['marked_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_absences_sample_id_fkey';
            columns: ['sample_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_samples';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_checks: {
        Row: {
          attempt: number;
          audio_bytes: number | null;
          audio_deleted_at: string | null;
          audio_etag: string | null;
          audio_path: string | null;
          audio_type: string | null;
          clarity: string | null;
          class_section_id: string;
          classroom: string | null;
          duration_ms: number | null;
          english_level: string;
          id: string;
          item: Json;
          item_code: string | null;
          item_seen_before: boolean;
          mode: string;
          noise_dbfs: number | null;
          prompt_code: string | null;
          reading_level: string;
          received_at: string;
          recorded_at: string;
          recorded_by: string | null;
          sample_id: string;
          student_id: string;
          tags: string[];
        };
        Insert: {
          attempt?: number;
          audio_bytes?: number | null;
          audio_deleted_at?: string | null;
          audio_etag?: string | null;
          audio_path?: string | null;
          audio_type?: string | null;
          clarity?: string | null;
          class_section_id: string;
          classroom?: string | null;
          duration_ms?: number | null;
          english_level: string;
          id?: string;
          item?: Json;
          item_code?: string | null;
          item_seen_before?: boolean;
          mode?: string;
          noise_dbfs?: number | null;
          prompt_code?: string | null;
          reading_level: string;
          received_at?: string;
          recorded_at: string;
          recorded_by?: string | null;
          sample_id: string;
          student_id: string;
          tags?: string[];
        };
        Update: {
          attempt?: number;
          audio_bytes?: number | null;
          audio_deleted_at?: string | null;
          audio_etag?: string | null;
          audio_path?: string | null;
          audio_type?: string | null;
          clarity?: string | null;
          class_section_id?: string;
          classroom?: string | null;
          duration_ms?: number | null;
          english_level?: string;
          id?: string;
          item?: Json;
          item_code?: string | null;
          item_seen_before?: boolean;
          mode?: string;
          noise_dbfs?: number | null;
          prompt_code?: string | null;
          reading_level?: string;
          received_at?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          sample_id?: string;
          student_id?: string;
          tags?: string[];
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_checks_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_checks_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_checks_sample_id_fkey';
            columns: ['sample_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_samples';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_checks_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_cycles: {
        Row: {
          class_section_id: string;
          drawn_at: string;
          eligible_count: number;
          first_week: number;
          grade: number;
          id: string;
          language: string;
          month: string;
          reserve_size: number;
          sample_size: number;
        };
        Insert: {
          class_section_id: string;
          drawn_at?: string;
          eligible_count: number;
          first_week: number;
          grade: number;
          id?: string;
          language: string;
          month: string;
          reserve_size: number;
          sample_size: number;
        };
        Update: {
          class_section_id?: string;
          drawn_at?: string;
          eligible_count?: number;
          first_week?: number;
          grade?: number;
          id?: string;
          language?: string;
          month?: string;
          reserve_size?: number;
          sample_size?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_cycles_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_reviews: {
        Row: {
          check_id: string;
          class_section_id: string;
          english_level: string;
          note: string | null;
          reading_level: string;
          reviewed_at: string;
          reviewed_by: string | null;
        };
        Insert: {
          check_id: string;
          class_section_id: string;
          english_level: string;
          note?: string | null;
          reading_level: string;
          reviewed_at?: string;
          reviewed_by?: string | null;
        };
        Update: {
          check_id?: string;
          class_section_id?: string;
          english_level?: string;
          note?: string | null;
          reading_level?: string;
          reviewed_at?: string;
          reviewed_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_reviews_check_id_fkey';
            columns: ['check_id'];
            isOneToOne: true;
            referencedRelation: 'pulse_checks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_reviews_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_reviews_reviewed_by_fkey';
            columns: ['reviewed_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_samples: {
        Row: {
          adapted: boolean;
          class_section_id: string;
          created_at: string;
          cycle_id: string;
          draw_position: number;
          due_on: string | null;
          id: string;
          opens_on: string | null;
          replaced_at: string | null;
          replacement_reason: string | null;
          replaces_sample_id: string | null;
          student_id: string;
          updated_at: string;
          week: number | null;
        };
        Insert: {
          adapted?: boolean;
          class_section_id: string;
          created_at?: string;
          cycle_id: string;
          draw_position: number;
          due_on?: string | null;
          id?: string;
          opens_on?: string | null;
          replaced_at?: string | null;
          replacement_reason?: string | null;
          replaces_sample_id?: string | null;
          student_id: string;
          updated_at?: string;
          week?: number | null;
        };
        Update: {
          adapted?: boolean;
          class_section_id?: string;
          created_at?: string;
          cycle_id?: string;
          draw_position?: number;
          due_on?: string | null;
          id?: string;
          opens_on?: string | null;
          replaced_at?: string | null;
          replacement_reason?: string | null;
          replaces_sample_id?: string | null;
          student_id?: string;
          updated_at?: string;
          week?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_samples_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_samples_cycle_id_fkey';
            columns: ['cycle_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_cycles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_samples_replaces_sample_id_fkey';
            columns: ['replaces_sample_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_samples';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_samples_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: false;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_score_failures: {
        Row: {
          attempts: number;
          check_id: string;
          engine_version: string;
          last_tried_at: string;
          reason: string;
        };
        Insert: {
          attempts?: number;
          check_id: string;
          engine_version: string;
          last_tried_at?: string;
          reason: string;
        };
        Update: {
          attempts?: number;
          check_id?: string;
          engine_version?: string;
          last_tried_at?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_score_failures_check_id_fkey';
            columns: ['check_id'];
            isOneToOne: true;
            referencedRelation: 'pulse_checks';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_scores: {
        Row: {
          check_id: string;
          class_section_id: string;
          confidence: number;
          engine_version: string;
          english_level: string;
          english_seconds: number;
          english_words: number;
          flags: string[];
          keyword_hits: number;
          other_language_share: number;
          reached_level: string;
          reading_correct: number;
          reading_items: number;
          reading_level: string;
          reading_seconds: number;
          scored_at: string;
          transcript: Json | null;
          transcript_deleted_at: string | null;
          wcpm: number | null;
        };
        Insert: {
          check_id: string;
          class_section_id: string;
          confidence: number;
          engine_version: string;
          english_level: string;
          english_seconds: number;
          english_words: number;
          flags?: string[];
          keyword_hits: number;
          other_language_share: number;
          reached_level: string;
          reading_correct: number;
          reading_items: number;
          reading_level: string;
          reading_seconds: number;
          scored_at?: string;
          transcript?: Json | null;
          transcript_deleted_at?: string | null;
          wcpm?: number | null;
        };
        Update: {
          check_id?: string;
          class_section_id?: string;
          confidence?: number;
          engine_version?: string;
          english_level?: string;
          english_seconds?: number;
          english_words?: number;
          flags?: string[];
          keyword_hits?: number;
          other_language_share?: number;
          reached_level?: string;
          reading_correct?: number;
          reading_items?: number;
          reading_level?: string;
          reading_seconds?: number;
          scored_at?: string;
          transcript?: Json | null;
          transcript_deleted_at?: string | null;
          wcpm?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_scores_check_id_fkey';
            columns: ['check_id'];
            isOneToOne: true;
            referencedRelation: 'pulse_checks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_scores_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_scoring_runs: {
        Row: {
          compared: number;
          engine_version: string;
          english_kappa: number | null;
          failed: number;
          finished_at: string;
          id: string;
          reading_kappa: number | null;
          runner: string;
          scored: number;
          started_at: string;
        };
        Insert: {
          compared?: number;
          engine_version: string;
          english_kappa?: number | null;
          failed: number;
          finished_at?: string;
          id?: string;
          reading_kappa?: number | null;
          runner: string;
          scored: number;
          started_at: string;
        };
        Update: {
          compared?: number;
          engine_version?: string;
          english_kappa?: number | null;
          failed?: number;
          finished_at?: string;
          id?: string;
          reading_kappa?: number | null;
          runner?: string;
          scored?: number;
          started_at?: string;
        };
        Relationships: [];
      };
      pulse_week_batches: {
        Row: {
          ciphertext: string;
          class_section_id: string;
          cycle_id: string;
          iv: string;
          mac: string;
          opens_on: string;
          week: number;
        };
        Insert: {
          ciphertext: string;
          class_section_id: string;
          cycle_id: string;
          iv: string;
          mac: string;
          opens_on: string;
          week: number;
        };
        Update: {
          ciphertext?: string;
          class_section_id?: string;
          cycle_id?: string;
          iv?: string;
          mac?: string;
          opens_on?: string;
          week?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_week_batches_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_week_batches_cycle_id_fkey';
            columns: ['cycle_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_cycles';
            referencedColumns: ['id'];
          },
        ];
      };
      pulse_week_keys: {
        Row: {
          class_section_id: string;
          cycle_id: string;
          key: string;
          opens_on: string;
          week: number;
        };
        Insert: {
          class_section_id: string;
          cycle_id: string;
          key: string;
          opens_on: string;
          week: number;
        };
        Update: {
          class_section_id?: string;
          cycle_id?: string;
          key?: string;
          opens_on?: string;
          week?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'pulse_week_keys_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'pulse_week_keys_cycle_id_fkey';
            columns: ['cycle_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_cycles';
            referencedColumns: ['id'];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth_secret: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_sent_at: string | null;
          p256dh: string;
          profile_id: string;
        };
        Insert: {
          auth_secret: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_sent_at?: string | null;
          p256dh: string;
          profile_id: string;
        };
        Update: {
          auth_secret?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_sent_at?: string | null;
          p256dh?: string;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      rehearsal_debriefs: {
        Row: {
          agreed_check_back: boolean;
          asked_constraints: boolean;
          cited_evidence: boolean;
          created_at: string;
          crp_id: string;
          id: string;
          kept_blame_out: boolean;
          language: string;
          named_practice: boolean;
          provider: string;
          scenario: string;
          try_next: string;
          turns: number;
          went_well: string;
        };
        Insert: {
          agreed_check_back: boolean;
          asked_constraints: boolean;
          cited_evidence: boolean;
          created_at?: string;
          crp_id: string;
          id?: string;
          kept_blame_out: boolean;
          language?: string;
          named_practice: boolean;
          provider: string;
          scenario: string;
          try_next: string;
          turns: number;
          went_well: string;
        };
        Update: {
          agreed_check_back?: boolean;
          asked_constraints?: boolean;
          cited_evidence?: boolean;
          created_at?: string;
          crp_id?: string;
          id?: string;
          kept_blame_out?: boolean;
          language?: string;
          named_practice?: boolean;
          provider?: string;
          scenario?: string;
          try_next?: string;
          turns?: number;
          went_well?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'rehearsal_debriefs_crp_id_fkey';
            columns: ['crp_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      schools: {
        Row: {
          cluster_id: string;
          created_at: string;
          id: string;
          is_active: boolean;
          name_en: string;
          name_hi: string | null;
          udise_code: string;
          updated_at: string;
          village: string | null;
        };
        Insert: {
          cluster_id: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name_en: string;
          name_hi?: string | null;
          udise_code: string;
          updated_at?: string;
          village?: string | null;
        };
        Update: {
          cluster_id?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          name_en?: string;
          name_hi?: string | null;
          udise_code?: string;
          updated_at?: string;
          village?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'schools_cluster_id_fkey';
            columns: ['cluster_id'];
            isOneToOne: false;
            referencedRelation: 'clusters';
            referencedColumns: ['id'];
          },
        ];
      };
      staff_assignments: {
        Row: {
          block_id: string | null;
          cluster_id: string | null;
          created_at: string;
          created_by: string | null;
          district_id: string | null;
          ends_on: string | null;
          id: string;
          role: Database['public']['Enums']['staff_role'];
          school_id: string | null;
          starts_on: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          block_id?: string | null;
          cluster_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          district_id?: string | null;
          ends_on?: string | null;
          id?: string;
          role: Database['public']['Enums']['staff_role'];
          school_id?: string | null;
          starts_on?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          block_id?: string | null;
          cluster_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          district_id?: string | null;
          ends_on?: string | null;
          id?: string;
          role?: Database['public']['Enums']['staff_role'];
          school_id?: string | null;
          starts_on?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_assignments_block_id_fkey';
            columns: ['block_id'];
            isOneToOne: false;
            referencedRelation: 'blocks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_cluster_id_fkey';
            columns: ['cluster_id'];
            isOneToOne: false;
            referencedRelation: 'clusters';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_district_id_fkey';
            columns: ['district_id'];
            isOneToOne: false;
            referencedRelation: 'districts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'staff_assignments_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      states: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          name_en: string;
          name_hi: string | null;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          name_en: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          name_en?: string;
          name_hi?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      student_contacts: {
        Row: {
          created_at: string;
          guardian_name: string;
          guardian_phone: string | null;
          relationship: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          guardian_name: string;
          guardian_phone?: string | null;
          relationship: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          guardian_name?: string;
          guardian_phone?: string | null;
          relationship?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'student_contacts_student_id_fkey';
            columns: ['student_id'];
            isOneToOne: true;
            referencedRelation: 'students';
            referencedColumns: ['id'];
          },
        ];
      };
      students: {
        Row: {
          admission_number: string | null;
          auth_user_id: string | null;
          created_at: string;
          created_by: string | null;
          date_of_birth: string | null;
          full_name: string;
          gender: string;
          has_special_needs: boolean;
          id: string;
          left_on: string | null;
          left_reason: string | null;
          school_id: string;
          status: string;
          student_code: string;
          updated_at: string;
          verified_at: string | null;
          verified_by: string | null;
        };
        Insert: {
          admission_number?: string | null;
          auth_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          full_name: string;
          gender: string;
          has_special_needs?: boolean;
          id?: string;
          left_on?: string | null;
          left_reason?: string | null;
          school_id: string;
          status?: string;
          student_code: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Update: {
          admission_number?: string | null;
          auth_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          full_name?: string;
          gender?: string;
          has_special_needs?: boolean;
          id?: string;
          left_on?: string | null;
          left_reason?: string | null;
          school_id?: string;
          status?: string;
          student_code?: string;
          updated_at?: string;
          verified_at?: string | null;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'students_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'students_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'students_verified_by_fkey';
            columns: ['verified_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_feedback: {
        Row: {
          agreed_at: string | null;
          change_note: string | null;
          check_back_on: string;
          demo_given: boolean;
          evidence: Json;
          language: string;
          plan_note: string | null;
          practice_code: string;
          strength: string;
          technique: string | null;
          visit_id: string;
        };
        Insert: {
          agreed_at?: string | null;
          change_note?: string | null;
          check_back_on: string;
          demo_given?: boolean;
          evidence?: Json;
          language?: string;
          plan_note?: string | null;
          practice_code: string;
          strength: string;
          technique?: string | null;
          visit_id: string;
        };
        Update: {
          agreed_at?: string | null;
          change_note?: string | null;
          check_back_on?: string;
          demo_given?: boolean;
          evidence?: Json;
          language?: string;
          plan_note?: string | null;
          practice_code?: string;
          strength?: string;
          technique?: string | null;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_feedback_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: true;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_feedback_scores: {
        Row: {
          check_back: number;
          crp_id: string | null;
          demonstration: number;
          evidence: number;
          feedback_agreed_at: string;
          feedback_fingerprint: string;
          language: string;
          model: string;
          one_focus: number;
          respectful: number;
          scored_at: string;
          specific: number;
          tip: string;
          total: number | null;
          visit_id: string;
        };
        Insert: {
          check_back: number;
          crp_id?: string | null;
          demonstration: number;
          evidence: number;
          feedback_agreed_at: string;
          feedback_fingerprint?: string;
          language?: string;
          model: string;
          one_focus: number;
          respectful: number;
          scored_at?: string;
          specific: number;
          tip: string;
          total?: number | null;
          visit_id: string;
        };
        Update: {
          check_back?: number;
          crp_id?: string | null;
          demonstration?: number;
          evidence?: number;
          feedback_agreed_at?: string;
          feedback_fingerprint?: string;
          language?: string;
          model?: string;
          one_focus?: number;
          respectful?: number;
          scored_at?: string;
          specific?: number;
          tip?: string;
          total?: number | null;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_feedback_scores_crp_id_fkey';
            columns: ['crp_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_feedback_scores_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: true;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_moments: {
        Row: {
          at_seconds: number;
          id: string;
          note: string | null;
          tag_code: string;
          visit_id: string;
        };
        Insert: {
          at_seconds: number;
          id: string;
          note?: string | null;
          tag_code: string;
          visit_id: string;
        };
        Update: {
          at_seconds?: number;
          id?: string;
          note?: string | null;
          tag_code?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_moments_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: false;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_notes: {
        Row: {
          audio_bytes: number;
          audio_deleted_at: string | null;
          audio_etag: string | null;
          audio_path: string;
          audio_type: string;
          duration_ms: number;
          language: string;
          note_id: string;
          received_at: string;
          recorded_at: string;
          recorded_by: string | null;
          transcribed_at: string | null;
          transcript: string | null;
          transcript_engine: string | null;
          transcript_failed_engine: string | null;
          transcript_failures: number;
          visit_id: string;
        };
        Insert: {
          audio_bytes: number;
          audio_deleted_at?: string | null;
          audio_etag?: string | null;
          audio_path: string;
          audio_type: string;
          duration_ms: number;
          language?: string;
          note_id: string;
          received_at?: string;
          recorded_at: string;
          recorded_by?: string | null;
          transcribed_at?: string | null;
          transcript?: string | null;
          transcript_engine?: string | null;
          transcript_failed_engine?: string | null;
          transcript_failures?: number;
          visit_id: string;
        };
        Update: {
          audio_bytes?: number;
          audio_deleted_at?: string | null;
          audio_etag?: string | null;
          audio_path?: string;
          audio_type?: string;
          duration_ms?: number;
          language?: string;
          note_id?: string;
          received_at?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          transcribed_at?: string | null;
          transcript?: string | null;
          transcript_engine?: string | null;
          transcript_failed_engine?: string | null;
          transcript_failures?: number;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_notes_recorded_by_fkey';
            columns: ['recorded_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_notes_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: true;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_observations: {
        Row: {
          answer: string | null;
          item_code: string;
          note: string | null;
          position: number;
          visit_id: string;
        };
        Insert: {
          answer?: string | null;
          item_code: string;
          note?: string | null;
          position: number;
          visit_id: string;
        };
        Update: {
          answer?: string | null;
          item_code?: string;
          note?: string | null;
          position?: number;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_observations_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: false;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_rechecks: {
        Row: {
          check_id: string;
          english_level: string;
          note: string | null;
          reading_level: string;
          visit_id: string;
        };
        Insert: {
          check_id: string;
          english_level: string;
          note?: string | null;
          reading_level: string;
          visit_id: string;
        };
        Update: {
          check_id?: string;
          english_level?: string;
          note?: string | null;
          reading_level?: string;
          visit_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_rechecks_check_id_fkey';
            columns: ['check_id'];
            isOneToOne: false;
            referencedRelation: 'pulse_checks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_rechecks_visit_id_fkey';
            columns: ['visit_id'];
            isOneToOne: false;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
        ];
      };
      visit_requests: {
        Row: {
          answered_by_visit_id: string | null;
          class_section_id: string;
          created_at: string;
          id: string;
          note: string | null;
          requested_by: string | null;
          school_id: string;
          topic: string;
          withdrawn_at: string | null;
        };
        Insert: {
          answered_by_visit_id?: string | null;
          class_section_id: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          requested_by?: string | null;
          school_id: string;
          topic: string;
          withdrawn_at?: string | null;
        };
        Update: {
          answered_by_visit_id?: string | null;
          class_section_id?: string;
          created_at?: string;
          id?: string;
          note?: string | null;
          requested_by?: string | null;
          school_id?: string;
          topic?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'visit_requests_answered_by_visit_id_fkey';
            columns: ['answered_by_visit_id'];
            isOneToOne: false;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_requests_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_requests_requested_by_fkey';
            columns: ['requested_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visit_requests_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
        ];
      };
      visits: {
        Row: {
          class_section_id: string;
          client_change_id: string | null;
          created_at: string;
          crp_id: string | null;
          done_at: string | null;
          finished_at: string | null;
          follow_up_result: string | null;
          follows_visit_id: string | null;
          id: string;
          lesson_note: string | null;
          planned_on: string | null;
          request_id: string | null;
          revision: number;
          school_id: string;
          started_at: string | null;
          status: string;
          teacher_id: string | null;
          updated_at: string;
          visited_on: string | null;
        };
        Insert: {
          class_section_id: string;
          client_change_id?: string | null;
          created_at?: string;
          crp_id?: string | null;
          done_at?: string | null;
          finished_at?: string | null;
          follow_up_result?: string | null;
          follows_visit_id?: string | null;
          id: string;
          lesson_note?: string | null;
          planned_on?: string | null;
          request_id?: string | null;
          revision?: number;
          school_id: string;
          started_at?: string | null;
          status?: string;
          teacher_id?: string | null;
          updated_at?: string;
          visited_on?: string | null;
        };
        Update: {
          class_section_id?: string;
          client_change_id?: string | null;
          created_at?: string;
          crp_id?: string | null;
          done_at?: string | null;
          finished_at?: string | null;
          follow_up_result?: string | null;
          follows_visit_id?: string | null;
          id?: string;
          lesson_note?: string | null;
          planned_on?: string | null;
          request_id?: string | null;
          revision?: number;
          school_id?: string;
          started_at?: string | null;
          status?: string;
          teacher_id?: string | null;
          updated_at?: string;
          visited_on?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'visits_class_section_id_fkey';
            columns: ['class_section_id'];
            isOneToOne: false;
            referencedRelation: 'class_sections';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_crp_id_fkey';
            columns: ['crp_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_follows_visit_id_fkey';
            columns: ['follows_visit_id'];
            isOneToOne: false;
            referencedRelation: 'visits';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_request_id_fkey';
            columns: ['request_id'];
            isOneToOne: false;
            referencedRelation: 'visit_requests';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_school_id_fkey';
            columns: ['school_id'];
            isOneToOne: false;
            referencedRelation: 'schools';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'visits_teacher_id_fkey';
            columns: ['teacher_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_overview: { Args: never; Returns: Json };
      area_report: { Args: { month_count?: number }; Returns: Json };
      child_progress: { Args: { target_student_id: string }; Returns: Json };
      class_progress: {
        Args: { target_class_section_id: string };
        Returns: Json;
      };
      crp_class_signal: {
        Args: never;
        Returns: {
          check_back_on: string;
          check_back_visit_id: string;
          class_section_id: string;
          english_no_response: number;
          fluent: number;
          grade: number;
          hesitant: number;
          last_visit_on: string;
          marks_to_discuss: number;
          medium: string;
          needs_support: number;
          pulse_checked: number;
          pulse_month: string;
          request_topic: string;
          requested_at: string;
          school_id: string;
          section: string;
          to_listen: number;
          visits_this_year: number;
        }[];
      };
      exam_marks_checks: {
        Args: { since?: string };
        Returns: {
          class_section_id: string;
          compared: number;
          exam_id: string;
          flagged: boolean;
          held_on: string;
          high_but_weak: number;
          high_marks: number;
          low_but_strong: number;
          paper_id: string;
          school_id: string;
          subject: string;
        }[];
      };
      exam_marks_pulse: {
        Args: { since?: string; target_paper_id?: string };
        Returns: {
          check_id: string;
          paper_id: string;
          percent: number;
          pulse_level: string;
          source: string;
          student_id: string;
        }[];
      };
      family_sign_in_active: {
        Args: { student: Database['public']['Tables']['students']['Row'] };
        Returns: boolean;
      };
      import_schools: { Args: { rows: Json }; Returns: Json };
      import_students: {
        Args: {
          rows: Json;
          target_academic_year_id: string;
          target_school_id: string;
        };
        Returns: Json;
      };
      keep_push_subscription: {
        Args: { auth_secret: string; endpoint: string; p256dh: string };
        Returns: undefined;
      };
      move_exam_paper: {
        Args: {
          new_held_on: string;
          new_max_marks?: number;
          target_paper_id: string;
        };
        Returns: undefined;
      };
      my_access: { Args: never; Returns: Json };
      my_attendance: {
        Args: { since?: string };
        Returns: {
          attendance_date: string;
          present: boolean;
        }[];
      };
      my_demo: { Args: never; Returns: Json };
      my_schools_overview: {
        Args: never;
        Returns: {
          active_students: number;
          cluster_id: string;
          current_classes: number;
          name_en: string;
          name_hi: string;
          pending_students: number;
          school_id: string;
          teachers: number;
          udise_code: string;
        }[];
      };
      pulse_items_seen: {
        Args: { student_ids: string[] };
        Returns: {
          item_code: string;
          prompt_code: string;
          student_id: string;
        }[];
      };
      remove_exam: { Args: { target_exam_id: string }; Returns: undefined };
      save_exam: { Args: { exam: Json }; Returns: undefined };
      save_exam_marks: { Args: { paper_marks: Json }; Returns: number };
      save_visit: { Args: { visit: Json }; Returns: number };
      service_demo_account: {
        Args: { role: string; target_sandbox: string };
        Returns: string;
      };
      service_demo_account_deleted: {
        Args: { target_user_id: string };
        Returns: undefined;
      };
      service_demo_accounts_to_delete: {
        Args: { batch_size?: number };
        Returns: Json;
      };
      service_demo_build: {
        Args: { details?: Json; phase: string; target_sandbox: string };
        Returns: Json;
      };
      service_demo_due: { Args: { batch_size?: number }; Returns: Json };
      service_demo_expire: {
        Args: { target_sandbox: string };
        Returns: boolean;
      };
      service_demo_note_account: {
        Args: { target_sandbox: string; target_user_id: string };
        Returns: undefined;
      };
      service_demo_open: { Args: { client_key: string }; Returns: Json };
      service_demo_remove: {
        Args: { target_sandbox: string };
        Returns: boolean;
      };
      service_demo_removing: {
        Args: { target_sandbox: string };
        Returns: undefined;
      };
      service_demo_sandbox_of: {
        Args: { target_user_id: string };
        Returns: string;
      };
      service_is_demo_account: {
        Args: { target_user_id: string };
        Returns: boolean;
      };
      service_job_token_valid: {
        Args: { job: string; token: string };
        Returns: boolean;
      };
      service_mark_pulse_audio_removed: {
        Args: { paths: string[] };
        Returns: number;
      };
      service_mark_visit_notes_removed: {
        Args: { paths: string[] };
        Returns: number;
      };
      service_pulse_agreement: {
        Args: { current_engine: string; since: string };
        Returns: {
          checks: number;
          machine_english: string;
          machine_reading: string;
          teacher_english: string;
          teacher_reading: string;
        }[];
      };
      service_pulse_audio_to_remove: {
        Args: { batch_size?: number };
        Returns: {
          path: string;
          reason: string;
        }[];
      };
      service_pulse_checks_to_score: {
        Args: { batch_size: number; current_engine: string };
        Returns: {
          audio_path: string;
          audio_type: string;
          check_id: string;
          duration_ms: number;
          grade: number;
          item: Json;
          item_seen_before: boolean;
          reading_language: string;
        }[];
      };
      service_push_outcome: {
        Args: { gone: string[]; sent: string[] };
        Returns: undefined;
      };
      service_push_recipients: {
        Args: { kind: string; on_date: string };
        Returns: {
          auth_secret: string;
          endpoint: string;
          first_count: number;
          language: string;
          message: string;
          p256dh: string;
          second_count: number;
        }[];
      };
      service_record_pulse_score_failure: {
        Args: {
          counts_attempt?: boolean;
          current_engine: string;
          failure_reason: string;
          target_check_id: string;
        };
        Returns: number;
      };
      service_record_visit_note_failure: {
        Args: { engine: string; target_path: string; target_visit_id: string };
        Returns: number;
      };
      service_return_ai_quota: {
        Args: { target_profile_id: string; usage_kind: string };
        Returns: undefined;
      };
      service_revoke_family_pin: {
        Args: { target_student_id: string };
        Returns: undefined;
      };
      service_save_visit_note_transcript: {
        Args: {
          engine: string;
          note_transcript: string;
          target_path: string;
          target_visit_id: string;
        };
        Returns: boolean;
      };
      service_set_family_pin: {
        Args: { issued_by: string; pin: string; target_student_id: string };
        Returns: undefined;
      };
      service_status: { Args: never; Returns: Json };
      service_take_ai_quota: {
        Args: {
          daily_limit: number;
          target_profile_id: string;
          usage_kind: string;
        };
        Returns: boolean;
      };
      service_verify_family_pin: {
        Args: { client_key: string; learner_code: string; pin: string };
        Returns: Json;
      };
      service_visit_notes_to_remove: {
        Args: { batch_size?: number };
        Returns: {
          path: string;
          reason: string;
        }[];
      };
      service_visit_notes_to_transcribe: {
        Args: { batch_size: number; current_engine?: string };
        Returns: {
          audio_path: string;
          audio_type: string;
          duration_ms: number;
          language: string;
          visit_id: string;
        }[];
      };
      transfer_assignment: {
        Args: {
          assignment_id: string;
          effective_on: string;
          new_role: Database['public']['Enums']['staff_role'];
          new_scope_id?: string;
        };
        Returns: string;
      };
    };
    Enums: {
      staff_role: 'super_admin' | 'district_officer' | 'block_officer' | 'crp' | 'teacher';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      staff_role: ['super_admin', 'district_officer', 'block_officer', 'crp', 'teacher'],
    },
  },
} as const;
