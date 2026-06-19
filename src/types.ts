export type User = {
  id: string;
  username: string;
};

export type AppVariables = {
  user: User | null;
  ip: string;
  userAgent: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
