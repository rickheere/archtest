(ns backend.router
  (:require [backend.handler :as handler]))

(def routes
  [["/users" handler/get-users]])
