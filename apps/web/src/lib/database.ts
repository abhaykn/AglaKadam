import type { Database as GeneratedDatabase } from './database.types';

export type { Json } from './database.types';

type GeneratedPublic = GeneratedDatabase['public'];
type GeneratedStudents = GeneratedPublic['Tables']['students'];

/**
 * The schema types generated from the database (`npm run db:types`), plus the computed columns,
 * which the generator lists only as functions. A computed column is a database function that is
 * selected like a column, for example `students?select=id,family_sign_in_active`.
 *
 * Import `Database` from here rather than from the generated file, which is overwritten whenever
 * the types are regenerated.
 */
export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedPublic, 'Tables'> & {
    Tables: Omit<GeneratedPublic['Tables'], 'students'> & {
      students: Omit<GeneratedStudents, 'Row'> & {
        Row: GeneratedStudents['Row'] & {
          /** `public.family_sign_in_active(students)`: the family account exists and is on. */
          family_sign_in_active: boolean | null;
        };
      };
    };
  };
};
