CREATE TABLE cocktail_order_counts (
  bar_id TEXT NOT NULL REFERENCES bars(id),
  cocktail_id INTEGER NOT NULL,
  cocktail_name TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0 CHECK(order_count >= 0),
  PRIMARY KEY(bar_id, cocktail_id)
);
INSERT INTO cocktail_order_counts(bar_id,cocktail_id,cocktail_name,order_count)
SELECT bar_id,cocktail_id,MAX(cocktail_name),COUNT(*) FROM orders GROUP BY bar_id,cocktail_id;
CREATE TRIGGER count_accepted_cocktail AFTER INSERT ON orders BEGIN
  INSERT INTO cocktail_order_counts(bar_id,cocktail_id,cocktail_name,order_count)
  VALUES(NEW.bar_id,NEW.cocktail_id,NEW.cocktail_name,1)
  ON CONFLICT(bar_id,cocktail_id) DO UPDATE SET
    order_count=cocktail_order_counts.order_count+1,
    cocktail_name=excluded.cocktail_name;
END;
