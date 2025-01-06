const AccountService = require('../service/account');
const WYAPI = require('../service/music_platform/wycloud');
const { storeCookie } = require('../service/music_platform/wycloud/transport.js');

async function get(req, res) {
    res.send({
        status: 0,
        data: {
            account: await getWyAccountInfo(req.account.uid)
        }
    });
}

async function set(req, res) {
    const loginType = req.body.loginType;
    const accountName = req.body.account;
    const password = req.body.password;
    const countryCode = req.body.countryCode;
    const config = req.body.config;
    const name = req.body.name;

    if (name) {
        // check if the name is already used by other accounts
        const allAccounts = await AccountService.getAllAccountsWithoutSensitiveInfo();
        for (const account of Object.values(allAccounts)) {
            if (account.name === name && account.uid !== req.account.uid) {
                res.status(412).send({ status: 1, message: '昵称已被占用啦，请换一个试试吧', data: {} });
                return;
            }
        }
    }

    const ret = await AccountService.setAccount(req.account.uid, loginType, accountName, password, countryCode, config, name);
    res.send({
        status: ret ? 0 : 1,
        data: {
            account: await getWyAccountInfo(req.account.uid)
        }
    });
}

async function getWyAccountInfo(uid) {
    const account = AccountService.getAccount(uid)
    const wyInfo = await WYAPI.getMyAccount(uid);
    account.wyAccount = wyInfo;
    return account;
}

async function qrLoginCreate(req, res) {
    const qrData = await WYAPI.qrLoginCreate(req.account.uid);
    if (qrData === false) {
        res.status(500).send({
            status: 1,
            message: 'qr login create failed',
            data: {}
        });
        return;
    }
    res.send({
        status: 0,
        data: {
            qrKey: qrData.qrKey,
            qrCode: qrData.qrCode,
        }
    });
}
async function qrLoginCheck(req, res) {
    // 800 为二维码过期; 801 为等待扫码; 802 为待确认; 803 为授权登录成功
    const loginCheckRet = await WYAPI.qrLoginCheck(req.account.uid, req.query.qrKey);
    let account = false;
    if (loginCheckRet.code == 803) {
        // it's a bad design to export the transport function here. Let's refactor it at a good time.
        // should be put the cookie method to a cookie manager service
        req.account.loginType = 'qrcode';
        req.account.account = 'temp';
        storeCookie(req.account.uid, req.account, loginCheckRet.cookie);
        
        account = await getWyAccountInfo(req.account.uid);
        req.account.account = account.wyAccount.userId;
        storeCookie(req.account.uid, req.account, loginCheckRet.cookie);

        AccountService.setAccount(req.account.uid, 'qrcode', account.wyAccount.userId, '', null);
        account = await getWyAccountInfo(req.account.uid);
    }
    res.send({
        status: loginCheckRet ? 0 : 1,
        data: {
            wyQrStatus: loginCheckRet.code,
            account
        }
    });
}

async function getAllAccounts(req, res) {
    const data = await AccountService.getAllAccountsWithoutSensitiveInfo();
    res.send({
        status: 0,
        data: data
    });
}

module.exports = {
    get: get,
    set: set,
    qrLoginCreate,
    qrLoginCheck,
    getAllAccounts,
}