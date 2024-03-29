import { ADM_NAME, ROLES } from "@/configs/settings";
import { MSG_400, MSG_403, MSG_500 } from "@/exceptions/HttpException";
import ExpressLog from "@/handlers/express_log.handler";
import { IUser } from "@/models/user.model";
import infoMongo, { stripeSecret } from "@/services/mongo/info.mongo";
import argon2 from "argon2";
import _ from "lodash";
import { v4 as uuidv4 } from "uuid";

interface UserSecretResponse {
  user: IUser;
  secret: string;
}

const checkAdminEnable = (users: IUser[]) => {
  return Boolean(users.length >= 1 && users[0].name === ADM_NAME && users[0].isActived);
};

const isMatchRole = (ownRoles: string[] | ROLES[], requiredRole?: string[]) => {
  if (requiredRole) {
    for (const role of ownRoles) {
      if (requiredRole.includes(role)) return true;
    }
    return false;
  }
  return true;
};

export const initAdm = async () => {
  const users = await infoMongo.listUsersWithSecret();
  if (!checkAdminEnable(users)) {
    await infoMongo.clearUsers();
    const userSecretResp = await createUserWithSecret(ADM_NAME, Object.values(ROLES).filter((v) => isNaN(Number(v))), false);
    await infoMongo.saveUser(userSecretResp.user);
    return userSecretResp.secret;
  }
  throw new Error(MSG_400["already_init"]);
};

export const createUserWithSecret = async (name: string, roles: ROLES[], isActived = true): Promise<UserSecretResponse> => {
  const secret = uuidv4();
  const user: IUser = {
    name: name,
    secret: await argon2.hash(secret),
    isActived: isActived,
    roles: roles,
  };
  return { user, secret };
};

export const activateUser = async (name: string) => {
  const user = await infoMongo.getUser(name);
  if (user) {
    if (user?.isActived) throw new Error(MSG_400["already_activated"]);
    user.isActived = !user.isActived;
    await infoMongo.saveUser(user);
  } else {
    throw new Error(MSG_400["user_not_found"]);
  }
}

export const checkAndGetAuthUser = async (secret?: string, needActived = true, requireRole?: string[], reqId?: string) => {
  const userList = await infoMongo.listUsersWithSecret();
  if (_.isEmpty(userList)) throw new Error(MSG_500["server_error"]);
  for (const user of userList) {
    if (user?.secret && secret && await argon2.verify(user.secret, secret)) {
      if (needActived && !user.isActived) throw new Error(MSG_403["not_activated"]);
      if (!user.roles || !isMatchRole(user.roles, requireRole)) throw new Error(MSG_403["permission_denied"]);

      if (reqId) await ExpressLog.updateUser(reqId, user.name);
      return stripeSecret(user);
    }
  }
  throw new Error(MSG_403["key_invalid"]);
};

export const checkRole = (roles: string[]) => {
  const result = Object.values(ROLES).filter(r => roles.indexOf(r) > -1);
  if (result.length === roles.length) return result;
  throw new Error(MSG_400["role_invalid"]);
}
