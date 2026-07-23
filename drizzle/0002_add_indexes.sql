CREATE INDEX "alerts_log_sent_at_idx" ON "alerts_log" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "alerts_log_status_sent_idx" ON "alerts_log" USING btree ("delivery_status","sent_at");--> statement-breakpoint
CREATE INDEX "alerts_log_meter_idx" ON "alerts_log" USING btree ("meter_id");--> statement-breakpoint
CREATE INDEX "channels_user_idx" ON "channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree ("status","current_period_end");