export interface Session {
  token: string;
  name?: string;
  userid?: string;
  clientid?: string;
  membertype?: string;
  enrollmentno?: string;
  instituteid?: string | null;
  institutename?: string | null;
  [key: string]: unknown;
}

export interface Captcha {
  hidden: string;
  image: string;
  imageDataUrl: string;
}

export interface Semester {
  registrationid?: string;
  registrationcode?: string;
  registrationdesc?: string;
}

export interface SectionProps {
  session: Session;
  onLogout?: () => void;
}
