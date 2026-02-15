(ns backend.handler
  (:require [backend.core.db :as db]))

(defn get-users []
  (db/query "SELECT * FROM users"))
