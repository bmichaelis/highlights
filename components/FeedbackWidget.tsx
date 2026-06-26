'use client';

import { useEffect } from 'react';

interface Props {
  userId: string;
  email: string;
}

export function FeedbackWidget({ userId, email }: Props) {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://feedback.kindacoach.com/widget/feedback-widget.js';
    script.onload = () => {
      (window as unknown as Window & { FeedbackWidget: { init: (c: unknown) => void } })
        .FeedbackWidget.init({
          apiKey: process.env.NEXT_PUBLIC_FEEDBACK_API_KEY,
          user: { id: userId, email },
        });
    };
    document.body.appendChild(script);
  }, [userId, email]);

  return null;
}
