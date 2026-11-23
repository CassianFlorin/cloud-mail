import accountService from '../service/account-service';
import userService from '../service/user-service';
import emailUtils from '../utils/email-utils';
import { isDel, settingConst } from '../const/entity-const';

// 找出收件地址对应的有效邮箱。已删除的邮箱或已删除用户的邮箱按不存在处理，
// 这样后台删掉一个地址就能让它停止收信。
// plusAddress 关闭时，a+tag@ 不再归到 a@，只有完全一致的地址能收信。
export async function resolveRecipient(env, to, plusAddress) {
	const c = { env };

	let account = await accountService.selectByEmailIncludeDel(c, to);

	if (!account && plusAddress !== settingConst.plusAddress.CLOSE) {
		const baseEmail = emailUtils.getBaseEmail(to);
		if (baseEmail && baseEmail !== to) {
			account = await accountService.selectByEmailIncludeDel(c, baseEmail);
		}
	}

	if (!account || account.isDel === isDel.DELETE) {
		return { account: null, userRow: {} };
	}

	const userRow = await userService.selectByIdIncludeDel(c, account.userId);

	if (!userRow || userRow.isDel === isDel.DELETE) {
		return { account: null, userRow: {} };
	}

	return { account, userRow };
}

// 后台「任意地址收信」里选中的域名任何地址都收：没有对应邮箱的信进未认领邮件，
// 不受「无人收件」开关影响。其他域名仍按开关处理。
export function isCatchAllDomain(catchAllDomain, to) {
	const list = Array.isArray(catchAllDomain) ? catchAllDomain
		: typeof catchAllDomain === 'string' ? catchAllDomain.split(',') : [];
	const domain = emailUtils.getDomain(to).trim().toLowerCase();
	return !!domain && list.some(item => String(item).trim().toLowerCase() === domain);
}

// 没有对应邮箱时是否拒收。
export function rejectsUnknownRecipient(catchAllDomain, to, noRecipient) {
	return noRecipient === settingConst.noRecipient.CLOSE && !isCatchAllDomain(catchAllDomain, to);
}
