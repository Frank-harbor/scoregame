@echo off
rem Refreshes the ratings, movies, games, clips and themes, then publishes them to the live site.
rem Double-click to run. It can take a few hours the first time; later runs are much quicker.
cd /d "%~dp0"
python -X utf8 tools\update_and_publish.py --fresh
rem Started by hand: keep the window open so the result can be read.
if "%~1"=="" pause
