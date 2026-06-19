@echo off
REM Run this once (requires Node.js) to bundle the frontend into backend/static.
REM After this, your friend only needs Python to run the app.

echo Building frontend...
cd frontend
call npm install
call npm run build
cd ..

echo Copying dist to backend\static...
if exist backend\static rmdir /s /q backend\static
xcopy /e /i /q frontend\dist backend\static

echo Done! Share the whole project folder with your friend.
echo They only need Python -- no Node, no Docker.
