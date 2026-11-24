-- Airbnb "Not available" events (advance notice, preparation time, owner blocks) were stored as
-- unknown stays, which created cleaning tasks and looked like reservations in the calendar.
-- Reclassify them as blocks. They still close the dates, but are not stays.
UPDATE external_calendar_events
   SET block_kind = 'owner_block'
 WHERE block_kind = 'unknown'
   AND raw_summary ~* '(not available|unavailable|blocked|closed|ikke tilgjengelig|sperret)';

-- Withdraw the cleaning tasks those events created (quietly – they were never real jobs).
UPDATE cleaning_tasks t
   SET status = 'cancelled', updated_at = now()
  FROM external_calendar_events e
 WHERE t.external_event_id = e.id
   AND e.block_kind = 'owner_block'
   AND t.status IN ('open', 'assigned');
