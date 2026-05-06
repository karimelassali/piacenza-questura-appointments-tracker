# Project Architecture & Logic: Booking Monitor

This document provides a detailed explanation of how the Booking Monitor works, its internal features, and how you can modify it.

---

## 1. Core Technologies
- **Node.js**: The runtime environment.
- **Playwright (Chromium)**: Used to automate a real browser. This is essential for Microsoft Bookings because the page is a "Single Page Application" (SPA) that loads content dynamically using JavaScript.
- **Telegram Bot API**: Used for real-time notifications with image support.
- **JSON Storage**: A simple file-based database to remember what has already been notified.

---

## 2. How the Monitoring Works

The monitoring process follows these exact steps when you run `npm run monitor`:

### A. Initialization
The script loads the environment variables from `.env` and initializes the `state.json` file. If it's the first time running, it creates the storage folder.

### B. Browser Automation (`src/services/monitor.js`)
1. **Stealth Launch**: It launches Chromium with a realistic `userAgent` and `viewport` to avoid being flagged as a bot.
2. **Page Load**: It navigates to the `BOOKING_URL` and waits for `networkidle` (when the page stops loading data).
3. **Smart Detection**:
    - **Dates**: It looks for buttons that have "available" in their `aria-label` or specific CSS classes like `.ms-Calendar-day--isAvailable`.
    - **Navigation**: After checking the current month, it searches for a "Next Month" button. If found, it clicks it, waits 3 seconds, and repeats the detection logic.
    - **Time Slots**: It scans all buttons for text that matches a time format (e.g., "09:00", "14:30"). To ensure slots are loaded, it automatically tries to click the first available day it finds.
4. **Screenshot**: It captures a full-page screenshot regardless of whether it found a slot or not, to give you visual proof.

### C. State Management & Anti-Spam (`src/storage/state.js`)
To prevent sending you the same message every 10 minutes:
1. It creates a **Hash** (a unique fingerprint) of the detected dates and times.
2. It compares this new Hash with the one stored in `storage/state.json`.
3. If they are the same, it logs "Availability unchanged" and stops.
4. If they are different (new slots appeared or old ones disappeared), it triggers a notification.

### D. Notifications (`src/services/telegram.js`)
The messages are formatted in **Moroccan Darija**. 
- It uses the `sendPhoto` method of the Telegram API to send the screenshot.
- The caption of the photo contains the list of dates, times, and a direct link to the booking page.

---

## 3. Project Features

1. **Dual-Month Check**: Scans both the current and the next month.
2. **Reliable Detection**: Uses `aria-labels` and smart regex to distinguish between actual buttons and static text.
3. **Retry Logic**: If the website is down or the internet fails, it retries up to 5 times with "Exponential Backoff" (waits longer between each try).
4. **Headless Mode**: Runs in the background without opening a visible browser window (perfect for servers).
5. **GitHub Actions Ready**: Includes a `.yml` file to run automatically every 10 minutes on GitHub's servers for free.

---

## 4. How to Edit & Customize

### To change the Check Frequency:
Edit `.github/workflows/booking-monitor.yml`:
```yaml
on:
  schedule:
    - cron: '*/10 * * * *'  # Change '10' to any number of minutes
```

### To change the Language/Text:
Edit `src/services/telegram.js`. Look for the `formatAlertMessage` and `formatNoAvailabilityMessage` functions. You can change the Darija text inside the backticks (`` ` ``).

### To change Browser behavior:
Edit `src/services/monitor.js`:
- To see the browser while it works (for debugging), change `headless: config.monitor.headless` to `headless: false`.
- To wait longer for the page, increase `await page.waitForTimeout(5000)`.

### To change Detection Logic:
Edit `src/utils/detection.js`. If the Microsoft Bookings website changes its design, you can update the `looksLikeTime` or `looksLikeDate` regex patterns here.

---

## 5. File Structure Recap

- `check-booking.js`: The "Brain". Orchestrates everything.
- `src/config/`: Reads your `.env` settings.
- `src/services/`: 
    - `monitor.js`: Browser scraping logic.
    - `telegram.js`: Message formatting and sending.
- `src/storage/`: Keeps the `state.json` and saved screenshots.
- `src/utils/`:
    - `logger.js`: Prints nice logs to your terminal.
    - `detection.js`: Helper functions for identifying slots.
