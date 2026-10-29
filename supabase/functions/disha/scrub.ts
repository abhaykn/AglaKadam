/**
 * Personal details a person may type into a conversation are taken out before the text is sent to
 * a language-model service: email addresses and phone numbers, and the ten-digit codes the school
 * hands out. Names cannot be recognised without a list, which is why the guide is also told never
 * to ask for them or repeat them.
 */

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
// An Indian mobile number, with or without +91 or a leading zero, and with spaces or dashes.
const MOBILE = /(?<![\d])(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?![\d])/g;
// Any other run of ten or more digits: a learner code, an account number.
const LONG_NUMBER = /(?<![\d])\d{10,}(?![\d])/g;

export function scrubPersonalDetails(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(MOBILE, '[number]')
    .replace(LONG_NUMBER, '[number]');
}
