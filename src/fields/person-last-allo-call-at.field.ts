import {
  defineField,
  FieldType,
  STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS,
} from 'twenty-sdk/define';

import { PERSON_LAST_ALLO_CALL_AT_FIELD_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

/**
 * Date of the most recent Allo call with this person.
 *
 * This duplicates information already reachable through `person.alloCalls`, on
 * purpose. Twenty does not let you filter on the "many" side of a relation: the
 * front only offers filters on RELATION fields whose relationType is
 * MANY_TO_ONE, so `alloCalls` can be displayed as a column but never used as a
 * filter criterion. A scalar can, which is the whole point of this field.
 *
 * A date rather than a counter: the write is idempotent (keep the newer of the
 * two), there is nothing to decrement when a call is deleted, and it answers
 * "not called in the last 30 days" as well as "never called", where a counter
 * only answers the second and drifts on delete.
 *
 * Written only by the logic functions in src/logic-functions/. Nothing stops a
 * human from editing it, but there is no reason to.
 */
export default defineField({
  universalIdentifier: PERSON_LAST_ALLO_CALL_AT_FIELD_UNIVERSAL_IDENTIFIER,
  objectUniversalIdentifier:
    STANDARD_OBJECT_UNIVERSAL_IDENTIFIERS.person.universalIdentifier,
  type: FieldType.DATE_TIME,
  name: 'lastAlloCallAt',
  label: 'Last Allo call',
  description:
    'Date of the most recent Allo call with this person. Maintained automatically. Filter on it to build calling lists: empty means never called.',
  icon: 'IconPhoneCall',
  isNullable: true,
});
