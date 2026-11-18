-- BR-PRP-010 / RULE-PRP-14: a proposal copied to a deal with a different currency keeps its prices unchanged and
-- must be reviewed before sending. The column holds the source currency while that review is pending (NULL = none).
ALTER TABLE proposal ADD COLUMN IF NOT EXISTS currency_review_from char(3);
