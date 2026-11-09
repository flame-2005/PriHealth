/**
 * The only step readers screens may use. A phone count and a watch total for the same day must
 * never be added: the source policy picks one (see `sourcePolicy.ts`).
 */
export { stepsByDay, stepsForDay, stepsPickForDay } from './sourcePolicy';
