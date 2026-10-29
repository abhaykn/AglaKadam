import { Building2, Compass, GraduationCap, House, type LucideIcon } from 'lucide-react';
import type { DemoRole } from './demo-api';

export const DEMO_ROLE_ICONS: Record<DemoRole, LucideIcon> = {
  teacher: GraduationCap,
  crp: Compass,
  officer: Building2,
  family: House,
};

/** What each role's card says the visitor will see. */
export const ROLE_SEES = {
  teacher: ['demo.roles.teacher.sees1', 'demo.roles.teacher.sees2', 'demo.roles.teacher.sees3'],
  crp: ['demo.roles.crp.sees1', 'demo.roles.crp.sees2', 'demo.roles.crp.sees3'],
  officer: ['demo.roles.officer.sees1', 'demo.roles.officer.sees2', 'demo.roles.officer.sees3'],
  family: ['demo.roles.family.sees1', 'demo.roles.family.sees2', 'demo.roles.family.sees3'],
} as const satisfies Record<DemoRole, readonly string[]>;

/** What the guide suggests trying in each role, in order. */
export const GUIDE_STEPS = {
  teacher: [
    'demo.guide.teacher.step1',
    'demo.guide.teacher.step2',
    'demo.guide.teacher.step3',
    'demo.guide.teacher.step4',
    'demo.guide.teacher.step5',
  ],
  crp: [
    'demo.guide.crp.step1',
    'demo.guide.crp.step2',
    'demo.guide.crp.step3',
    'demo.guide.crp.step4',
    'demo.guide.crp.step5',
    'demo.guide.crp.step6',
  ],
  officer: ['demo.guide.officer.step1', 'demo.guide.officer.step2', 'demo.guide.officer.step3'],
  family: [
    'demo.guide.family.step1',
    'demo.guide.family.step2',
    'demo.guide.family.step3',
    'demo.guide.family.step4',
  ],
} as const satisfies Record<DemoRole, readonly string[]>;
